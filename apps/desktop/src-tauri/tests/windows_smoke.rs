//! Windows smoke verification harness.
//!
//! Drives the exact services the Tauri commands wrap — the same generic
//! inner command functions over the composition root — instead of reaching
//! into private module internals. The crate-private modules are only
//! reachable through the crate's public API, so the harness composes
//! through the `#[doc(hidden)] pub mod smoke` seam in `lib.rs`, which is
//! test-only and may change or disappear without notice.
//!
//! Scenario 1 (deterministic, runs on any host): a fake Steam registry and
//! a fake protocol opener reproduce the whole checklist — registry path
//! found, declared libraries scanned, a known installed manifest
//! normalized to a path-free DTO, `steam://rungameid/<appid>` on launch,
//! `steam://install/<appid>` on install, and `Installed`/`Installing`/
//! `Unknown` on status refresh.
//!
//! Scenario 2 (host-dependent): the real production locator over the real
//! `WindowsSteamRegistry` adapter. On this macOS host the adapter is the
//! stable stub and the scan must return the typed `steam-not-installed`
//! error instead of panicking; on Windows with Steam installed the same
//! code path exercises the real Registry. Either way the app surface must
//! stay usable.

use fuse_launcher_desktop_lib::smoke::{
    game_actions_get_install_status_inner, game_actions_install_inner, game_actions_launch_inner,
    local_library_scan_inner, ActionAcceptedDto, CommandError, DiscoveryError, GameActionError,
    GameActionService, InstallStatusDto, InstallStatusService, InstallStatusStateDto,
    LaunchHistoryStore, LocalGameDto, LocalInstallState, LocalInstallStateDto,
    LocalLibrarySnapshot, ProtocolOpener, ProviderDto, RuntimeState, ScanLocalLibrary,
    SharedSnapshot, SteamAppId, SteamLibraryLocator, SteamRegistry, SteamUri, ValveKeyValueParser,
    WindowsSteamRegistry,
};
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

/// A Steam registry fake reporting one candidate install root, exactly like
/// the production `WindowsSteamRegistry` does for a Steam installation.
#[derive(Clone)]
struct FakeRegistry {
    paths: Vec<PathBuf>,
}

impl SteamRegistry for FakeRegistry {
    fn candidate_install_paths(&self) -> Result<Vec<PathBuf>, DiscoveryError> {
        Ok(self.paths.clone())
    }
}

/// An opener fake that records the URIs it was asked to open, backed by a
/// shared buffer so the harness can assert on it after the service moved
/// the fake into the composition root.
#[derive(Clone)]
struct FakeOpener {
    opened: Arc<Mutex<Vec<String>>>,
}

impl FakeOpener {
    fn default() -> Self {
        Self {
            opened: Arc::new(Mutex::new(Vec::new())),
        }
    }
}

impl ProtocolOpener for FakeOpener {
    fn open(&self, uri: &SteamUri) -> Result<(), GameActionError> {
        self.opened
            .lock()
            .expect("opener log poisoned")
            .push(uri.as_str().to_string());
        Ok(())
    }
}

/// A temporary pair of Steam libraries under the system temp directory:
/// the root installation plus one declared library folder, both with a
/// `steamapps` directory. Absolute paths only (the crate-wide constraint
/// from the locator tests); the fixture removes itself on drop.
struct FixtureLibraries {
    base: PathBuf,
    root: PathBuf,
    second: PathBuf,
}

impl FixtureLibraries {
    fn new() -> Self {
        static COUNTER: AtomicU64 = AtomicU64::new(0);
        let base = std::env::temp_dir().join(format!(
            "fuse-launcher-windows-smoke-{}-{}",
            std::process::id(),
            COUNTER.fetch_add(1, Ordering::Relaxed)
        ));
        let _ = std::fs::remove_dir_all(&base);
        let root = base.join("root");
        let second = base.join("second");
        std::fs::create_dir_all(root.join("steamapps")).expect("create root steamapps dir");
        std::fs::create_dir_all(second.join("steamapps")).expect("create second steamapps dir");
        Self { base, root, second }
    }

    /// Writes a `libraryfolders.vdf` declaring both libraries, Steam-shaped.
    fn with_declared_libraries(self) -> Self {
        let mut vdf = String::from("\"libraryfolders\"\n{\n");
        for (index, folder) in [&self.root, &self.second].iter().enumerate() {
            let escaped = folder
                .to_string_lossy()
                .replace('\\', "\\\\")
                .replace('"', "\\\"");
            vdf.push_str(&format!(
                "\t\"{index}\"\n\t{{\n\t\t\"path\"\t\t\"{escaped}\"\n\t}}\n"
            ));
        }
        vdf.push_str("}\n");
        std::fs::write(self.root.join("steamapps").join("libraryfolders.vdf"), vdf)
            .expect("write libraryfolders.vdf fixture");
        self
    }

    /// Writes the committed 730 fixture manifest (StateFlags 4) into the
    /// root library and creates its install directory, so it normalizes to
    /// `Installed`.
    fn with_installed_game(self) -> Self {
        std::fs::write(
            self.root.join("steamapps").join("appmanifest_730.acf"),
            include_str!("fixtures/appmanifest_730.acf"),
        )
        .expect("write 730 manifest fixture");
        std::fs::create_dir_all(
            self.root
                .join("steamapps")
                .join("common")
                .join("Counter-Strike Global Offensive"),
        )
        .expect("create 730 install dir fixture");
        self
    }

    /// Writes the committed 570 fixture manifest (StateFlags 1026) into the
    /// declared library with no install directory, so it normalizes to
    /// `Installing`.
    fn with_incomplete_game(self) -> Self {
        std::fs::write(
            self.second.join("steamapps").join("appmanifest_570.acf"),
            include_str!("fixtures/appmanifest_570.acf"),
        )
        .expect("write 570 manifest fixture");
        self
    }

    /// Writes a malformed manifest for 999 into the declared library, so
    /// scans record a diagnostic and status refresh reports `Unknown`.
    fn with_malformed_manifest(self) -> Self {
        std::fs::write(
            self.second.join("steamapps").join("appmanifest_999.acf"),
            "not a valve keyvalues file",
        )
        .expect("write 999 manifest fixture");
        self
    }
}

impl Drop for FixtureLibraries {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.base);
    }
}

/// Builds the generic composition root exactly like `run()` does — the
/// locator is cloned into the scanner and the install-status service, and
/// the snapshot is shared with the action service — over a fake registry
/// and the given fake opener.
fn fake_registry_state(
    fixture: &FixtureLibraries,
    opener: FakeOpener,
) -> RuntimeState<SteamLibraryLocator<FakeRegistry>, FakeOpener> {
    let snapshot = Arc::new(Mutex::new(LocalLibrarySnapshot::new(
        Vec::new(),
        Vec::new(),
    )));
    let locator = SteamLibraryLocator::new(
        FakeRegistry {
            paths: vec![fixture.root.clone()],
        },
        ValveKeyValueParser,
    );
    RuntimeState {
        snapshot: snapshot.clone(),
        scanner: ScanLocalLibrary::new(locator.clone()),
        actions: GameActionService::new(SharedSnapshot::new(snapshot), opener),
        install_status: InstallStatusService::new(locator),
        history: LaunchHistoryStore::in_memory(),
    }
}

#[test]
fn fake_registry_scenario_exercises_the_full_smoke_checklist() {
    let fixture = FixtureLibraries::new()
        .with_declared_libraries()
        .with_installed_game()
        .with_incomplete_game()
        .with_malformed_manifest();
    let opener = FakeOpener::default();
    let opened = opener.opened.clone();
    let state = fake_registry_state(&fixture, opener);

    // Launch is refused before any scan: the shared snapshot is empty and
    // the action service must never authorize from a stale or absent scan.
    assert_eq!(
        game_actions_launch_inner(&state, 730),
        Err(CommandError {
            code: "game-not-installed".to_string(),
            message: "the game is not in the local installed snapshot".to_string(),
        })
    );

    // The registry path is found (through the fake port), the declared
    // libraries are scanned, and the known installed manifest normalizes to
    // `Installed` in a path-free DTO.
    let dto = tauri::async_runtime::block_on(local_library_scan_inner(&state))
        .expect("the fake-registry scan must succeed");
    assert_eq!(
        dto.games,
        vec![
            LocalGameDto {
                provider: ProviderDto::Steam,
                external_game_id: 730,
                name: "Counter-Strike 2".to_string(),
                state: LocalInstallStateDto::Installed,
            },
            LocalGameDto {
                provider: ProviderDto::Steam,
                external_game_id: 570,
                name: "Dota 2".to_string(),
                state: LocalInstallStateDto::Installing,
            },
        ],
        "the scan result must be the normalized, path-free DTO"
    );
    assert_eq!(dto.diagnostics.len(), 1);
    assert_eq!(dto.diagnostics[0].manifest, "appmanifest_999.acf");

    // The scan wrote the shared snapshot the action service reads on every
    // launch.
    let snapshot = state.snapshot.lock().expect("snapshot mutex poisoned");
    assert_eq!(
        snapshot
            .find(SteamAppId::new(730).unwrap())
            .unwrap()
            .state(),
        LocalInstallState::Installed
    );
    drop(snapshot);

    // Launch produces steam://rungameid/<appid> through the opener.
    assert_eq!(
        game_actions_launch_inner(&state, 730),
        Ok(ActionAcceptedDto { accepted: true })
    );
    // Install produces steam://install/<appid> through the opener.
    assert_eq!(
        game_actions_install_inner(&state, 570),
        Ok(ActionAcceptedDto { accepted: true })
    );
    assert_eq!(
        opened.lock().expect("opener log poisoned").as_slice(),
        &["steam://rungameid/730", "steam://install/570"]
    );

    // Status refresh returns Installed, Installing, and Unknown for the
    // three fixture states.
    assert_eq!(
        tauri::async_runtime::block_on(game_actions_get_install_status_inner(&state, 730))
            .expect("status refresh must stay typed"),
        InstallStatusDto {
            state: InstallStatusStateDto::Installed
        }
    );
    assert_eq!(
        tauri::async_runtime::block_on(game_actions_get_install_status_inner(&state, 570))
            .expect("status refresh must stay typed"),
        InstallStatusDto {
            state: InstallStatusStateDto::Installing
        }
    );
    assert_eq!(
        tauri::async_runtime::block_on(game_actions_get_install_status_inner(&state, 999))
            .expect("status refresh must stay typed"),
        InstallStatusDto {
            state: InstallStatusStateDto::Unknown
        }
    );

    drop(fixture);
}

#[test]
fn real_registry_stub_returns_a_stable_error_and_keeps_the_surface_usable() {
    // The real production composition: the Windows registry adapter — the
    // stable `SteamNotFound` stub on this host — through the real locator,
    // exactly as `run()` wires it.
    let snapshot = Arc::new(Mutex::new(LocalLibrarySnapshot::new(
        Vec::new(),
        Vec::new(),
    )));
    let locator = SteamLibraryLocator::new(WindowsSteamRegistry, ValveKeyValueParser);
    let opener = FakeOpener::default();
    let opened = opener.opened.clone();
    let state = RuntimeState {
        snapshot: snapshot.clone(),
        scanner: ScanLocalLibrary::new(locator.clone()),
        actions: GameActionService::new(SharedSnapshot::new(snapshot), opener),
        install_status: InstallStatusService::new(locator),
        history: LaunchHistoryStore::in_memory(),
    };

    // The Steam registry path is found on a real Steam machine (exercising
    // the real registry path) or the scan returns the stable typed error —
    // never a panic on a host without Steam.
    let scan = tauri::async_runtime::block_on(local_library_scan_inner(&state));
    if let Err(error) = &scan {
        assert_eq!(error.code, "steam-not-installed");
        // The exact message is only deterministic on non-Windows hosts, where
        // the stub registry always fails the same way; on Windows other
        // failure paths (e.g. spawn_blocking cancellation) map elsewhere.
        #[cfg(not(windows))]
        assert_eq!(
            error.message,
            "steam is not installed or no library could be found"
        );
    }
    // On non-Windows hosts the stub registry is deterministic: the scan
    // must report exactly the stable `steam-not-installed` error.
    #[cfg(not(windows))]
    assert_eq!(
        scan,
        Err(CommandError {
            code: "steam-not-installed".to_string(),
            message: "steam is not installed or no library could be found".to_string(),
        })
    );

    // The app surface remains usable without Steam: install still records
    // the request and opens the validated URI.
    assert_eq!(
        game_actions_install_inner(&state, 730),
        Ok(ActionAcceptedDto { accepted: true })
    );
    assert_eq!(
        opened.lock().expect("opener log poisoned").as_slice(),
        &["steam://install/730"]
    );

    // Status refresh stays typed and never panics; on this host the
    // unverifiable AppID reports `Unknown`.
    let status = tauri::async_runtime::block_on(game_actions_get_install_status_inner(&state, 999))
        .expect("status refresh must stay typed");
    #[cfg(not(windows))]
    assert_eq!(
        status,
        InstallStatusDto {
            state: InstallStatusStateDto::Unknown
        }
    );
    #[cfg(windows)]
    assert!(matches!(
        status.state,
        InstallStatusStateDto::Installed
            | InstallStatusStateDto::Installing
            | InstallStatusStateDto::Unknown
    ));

    // Launch stays typed while the snapshot is empty (no successful scan).
    #[cfg(not(windows))]
    assert_eq!(
        game_actions_launch_inner(&state, 730),
        Err(CommandError {
            code: "game-not-installed".to_string(),
            message: "the game is not in the local installed snapshot".to_string(),
        })
    );
}
