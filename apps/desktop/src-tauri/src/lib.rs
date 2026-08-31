mod commands;
mod modules;
mod observability;

use crate::modules::game_actions::application::game_action_service::ProtocolOpener;
use crate::modules::game_actions::{
    GameActionService, InstallStatusService, SnapshotProvider, SteamProtocolOpener,
};
use crate::modules::launch_history::LaunchHistoryStore;
use crate::modules::local_library::application::local_snapshot_dto::LocalSnapshotDto;
use crate::modules::local_library::application::scan_local_library::{
    LibraryDiscovery, ScanLocalLibrary,
};
use crate::modules::local_library::infrastructure::valve_kv::ValveKeyValueParser;
use crate::modules::local_library::{
    LocalLibrarySnapshot, SteamLibraryLocator, WindowsSteamRegistry,
};
use crate::modules::steam_watch::{
    SteamWatcher, SystemWatchClock, WatcherEmitter, LOCAL_LIBRARY_CHANGED_EVENT,
};
use std::sync::{Arc, Mutex};
use tauri::{Emitter, Manager};
use tauri_plugin_log::{FileOpenStrategy, RotationStrategy, Target, TargetKind, TimezoneStrategy};

/// The command-independent identity of the native runtime.
///
/// The desktop shell targets the Windows Steam runtime; the frontend uses
/// this to branch on native capability during boot.
pub fn runtime_name() -> &'static str {
    "windows-steam"
}

/// Shared native runtime state: the current snapshot plus the services
/// behind the five commands.
///
/// This is the composition root. It is generic over the library-discovery
/// and protocol-opener ports so the command layer can be composed with
/// fakes in tests; [`NativeRuntimeState`] is the production composition
/// managed by [`run`]. The registry locator is cloned into the scanner and
/// the install-status service; the snapshot is shared between the scan
/// command (writer) and the action service (reader), so launch always
/// checks the freshest scan result. The history store is concrete: it is a
/// desktop-local file-backed store, never an API concern.
///
/// The type and its fields are `pub` only so the test-only [`smoke`] seam
/// can re-export them to the integration smoke harness
/// (`tests/windows_smoke.rs`); the production wiring stays behind [`run`].
pub struct RuntimeState<L: LibraryDiscovery, O: ProtocolOpener> {
    /// The snapshot last produced by `local_library_scan`.
    pub snapshot: Arc<Mutex<LocalLibrarySnapshot>>,
    /// Scans the declared Steam libraries off the UI thread.
    pub scanner: ScanLocalLibrary<L>,
    /// Safe launch and install actions.
    pub actions: GameActionService<SharedSnapshot, O>,
    /// Manifest-based install-state refresh.
    pub install_status: InstallStatusService<L>,
    /// Desktop-local record of completed launches.
    pub history: LaunchHistoryStore,
}

/// The production composition: the Windows registry locator and the Tauri
/// protocol opener, as wired by [`run`].
pub(crate) type NativeRuntimeState =
    RuntimeState<SteamLibraryLocator<WindowsSteamRegistry>, SteamProtocolOpener>;

/// Publishes watcher scan results to the frontend as the
/// `local-library-changed` event, carrying only the path-free
/// [`LocalSnapshotDto`].
#[derive(Clone)]
struct TauriWatcherEmitter {
    app: tauri::AppHandle,
}

impl WatcherEmitter for TauriWatcherEmitter {
    fn emit(&self, dto: &LocalSnapshotDto) -> Result<(), String> {
        self.app
            .emit(LOCAL_LIBRARY_CHANGED_EVENT, dto)
            .map_err(|error| error.to_string())
    }
}

/// Snapshot provider reading the in-memory snapshot last produced by
/// `local_library_scan`.
///
/// The action service checks this provider on every launch, so a stale
/// scan can never authorize a launch of a game that is not installed.
///
/// Public only so the test-only [`smoke`] seam can re-export it to the
/// integration smoke harness.
#[derive(Debug)]
pub struct SharedSnapshot(Arc<Mutex<LocalLibrarySnapshot>>);

impl SharedSnapshot {
    /// Wraps the shared snapshot buffer.
    pub fn new(inner: Arc<Mutex<LocalLibrarySnapshot>>) -> Self {
        Self(inner)
    }
}

impl SnapshotProvider for SharedSnapshot {
    fn current(&self) -> LocalLibrarySnapshot {
        self.0.lock().expect("snapshot mutex poisoned").clone()
    }
}

/// Entrypoint of the Tauri application.
///
/// Registers the five stable command names, starts the local-library
/// watcher thread, and wires the opener and HTTP plugins with their
/// restricted URL capabilities (see `capabilities/default.json`).
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(
            // Info for the whole process; Debug for Fuse Launcher modules
            // modules so operators see scan/status details without
            // third-party crate noise.
            tauri_plugin_log::Builder::default()
                .targets([
                    Target::new(TargetKind::Stdout),
                    Target::new(TargetKind::LogDir {
                        file_name: Some("fuse-launcher".into()),
                    }),
                    Target::new(TargetKind::Webview),
                ])
                .rotation_strategy(RotationStrategy::KeepSome(5))
                .file_open_strategy(FileOpenStrategy::Rotate)
                .timezone_strategy(TimezoneStrategy::UseLocal)
                .max_file_size(5_000_000)
                .level(log::LevelFilter::Info)
                .level_for("fuse_launcher_desktop_lib", log::LevelFilter::Debug)
                .build(),
        )
        .setup(|app| {
            let resource_dir = app.path().resource_dir().ok();
            let data_dir = app.path().app_data_dir().ok();
            app.manage(observability::init_native_observability(
                resource_dir.as_deref(),
                data_dir.as_deref(),
            ));
            // The log plugin is initialized before the setup hook, so the
            // native log pipeline (stdout target) is live from the first
            // message the runtime emits.
            log::info!("starting Fuse Launcher desktop runtime");
            let locator = SteamLibraryLocator::new(WindowsSteamRegistry, ValveKeyValueParser);
            let snapshot = Arc::new(Mutex::new(LocalLibrarySnapshot::new(
                Vec::new(),
                Vec::new(),
            )));
            // The launch history lives in the app data directory; when the
            // path cannot be resolved the store falls back to in-memory so
            // Fuse Launcher still starts and records for the session.
            let history = match app.path().app_data_dir() {
                Ok(dir) => {
                    let path = dir.join("launch_history.json");
                    log::info!("launch history storage initialized");
                    LaunchHistoryStore::load(path)
                }
                Err(error) => {
                    log::warn!(
                        "app data directory unavailable ({error}); launch history is in-memory only"
                    );
                    LaunchHistoryStore::in_memory()
                }
            };
            // The watcher observes the known Steam sources on its own
            // thread, bounded by the poll interval; the process lifetime
            // owns the thread (it dies with Fuse Launcher). The snapshot is
            // shared with the scan command and the action service, so a
            // watcher scan refreshes the exact buffer every reader uses.
            std::thread::spawn({
                let locator = locator.clone();
                let snapshot = snapshot.clone();
                let app = app.handle().clone();
                move || {
                    SteamWatcher::new(
                        locator,
                        snapshot,
                        TauriWatcherEmitter { app },
                        SystemWatchClock,
                    )
                    .run()
                }
            });
            app.manage(NativeRuntimeState {
                snapshot: snapshot.clone(),
                scanner: ScanLocalLibrary::new(locator.clone()),
                actions: GameActionService::new(
                    SharedSnapshot::new(snapshot),
                    SteamProtocolOpener::new(app.handle().clone()),
                ),
                install_status: InstallStatusService::new(locator),
                history,
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::local_library::local_library_scan,
            commands::game_actions::game_actions_launch,
            commands::game_actions::game_actions_install,
            commands::game_actions::game_actions_get_install_status,
            commands::launch_history::launch_history_get,
            commands::diagnostics::diagnostics_open_logs,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

/// Test-only seam for the Windows smoke harness (`tests/windows_smoke.rs`).
///
/// Integration tests can only reach the crate's public API, so the harness
/// needs a small public door to the exact services the Tauri commands wrap:
/// the generic composition root, the inner command functions, the serde
/// DTOs, and the port traits it must implement with fakes. This module is
/// `#[doc(hidden)]`, is not part of the stable surface, and may change or
/// disappear without notice.
#[cfg(any(test, feature = "smoke"))]
#[doc(hidden)]
pub mod smoke {
    pub use crate::commands::game_actions::{
        game_actions_get_install_status_inner, game_actions_install_inner,
        game_actions_launch_inner, ActionAcceptedDto, InstallStatusDto, InstallStatusStateDto,
    };
    pub use crate::commands::launch_history::launch_history_get_inner;
    pub use crate::commands::local_library::local_library_scan_inner;
    pub use crate::commands::CommandError;
    pub use crate::modules::game_actions::application::game_action_service::ProtocolOpener;
    pub use crate::modules::game_actions::domain::install_status::GameActionError;
    pub use crate::modules::game_actions::domain::steam_uri::SteamUri;
    pub use crate::modules::game_actions::{GameActionService, InstallStatusService};
    pub use crate::modules::launch_history::{
        LaunchHistoryDto, LaunchHistoryEntryDto, LaunchHistoryStore,
    };
    pub use crate::modules::local_library::application::local_snapshot_dto::{
        LocalGameDto, LocalInstallStateDto, ProviderDto,
    };
    pub use crate::modules::local_library::application::scan_local_library::ScanLocalLibrary;
    pub use crate::modules::local_library::domain::local_game::{LocalInstallState, SteamAppId};
    pub use crate::modules::local_library::domain::local_library_snapshot::LocalLibrarySnapshot;
    pub use crate::modules::local_library::domain::steam_path::{DiscoveryError, SteamRegistry};
    pub use crate::modules::local_library::infrastructure::valve_kv::ValveKeyValueParser;
    pub use crate::modules::local_library::{SteamLibraryLocator, WindowsSteamRegistry};
    pub use crate::{RuntimeState, SharedSnapshot};
}

#[cfg(test)]
mod tests {
    use super::{runtime_name, RuntimeState, SharedSnapshot};
    use crate::commands::game_actions::{
        game_actions_get_install_status_inner, game_actions_install_inner,
        game_actions_launch_inner, ActionAcceptedDto, InstallStatusDto, InstallStatusStateDto,
    };
    use crate::commands::launch_history::launch_history_get_inner;
    use crate::commands::local_library::local_library_scan_inner;
    use crate::commands::CommandError;
    use crate::modules::game_actions::application::game_action_service::ProtocolOpener;
    use crate::modules::game_actions::domain::install_status::GameActionError;
    use crate::modules::game_actions::domain::steam_uri::SteamUri;
    use crate::modules::game_actions::{GameActionService, InstallStatusService};
    use crate::modules::launch_history::LaunchHistoryStore;
    use crate::modules::local_library::application::local_snapshot_dto::{
        LocalGameDto, LocalInstallStateDto, LocalSnapshotDto, ProviderDto,
    };
    use crate::modules::local_library::application::scan_local_library::{
        LibraryDiscovery, ScanLocalLibrary,
    };
    use crate::modules::local_library::domain::local_game::{LocalInstallState, SteamAppId};
    use crate::modules::local_library::domain::steam_path::{DiscoveryError, SteamLibrary};
    use crate::modules::local_library::LocalLibrarySnapshot;
    use std::cell::RefCell;
    use std::path::PathBuf;
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::sync::{Arc, Mutex};

    #[test]
    fn reports_the_windows_fuse_runtime() {
        assert_eq!(runtime_name(), "windows-steam");
    }

    /// The capability file is the security boundary of the native surface:
    /// the default capability must grant exactly `core:default`, the scoped
    /// `opener:allow-open-url` entry, the scoped `http:default` entry, and
    /// the two event permissions the local-library watcher needs to push
    /// fresh snapshots, the log bridge, the safe log-directory reveal, the
    /// signed updater, and the controlled process restart —
    /// and never the broad `opener:default` set.
    #[test]
    fn the_default_capability_grants_exactly_the_restricted_native_surface() {
        let raw = include_str!("../capabilities/default.json");
        let capabilities: serde_json::Value =
            serde_json::from_str(raw).expect("capabilities/default.json must stay valid json");

        let permissions = capabilities["permissions"]
            .as_array()
            .expect("permissions must be an array");
        assert_eq!(
            permissions.len(),
            9,
            "the default capability must grant exactly nine permission entries"
        );
        assert_eq!(
            permissions[0], "core:default",
            "core:default is the base permission of the default capability"
        );
        assert_eq!(
            permissions[1]["identifier"], "opener:allow-open-url",
            "the opener surface is the scoped allow-open-url permission"
        );
        assert_eq!(
            permissions[2]["identifier"], "http:default",
            "the HTTP surface is the scoped default HTTP permission"
        );
        assert_eq!(
            permissions[3], "log:default",
            "the log plugin must be available to attach the webview console"
        );
        assert_eq!(
            permissions[4], "updater:default",
            "the updater plugin must use its scoped default permission"
        );
        assert_eq!(
            permissions[5], "process:allow-restart",
            "updates may restart the current application only"
        );
        assert_eq!(
            permissions[6], "opener:allow-reveal-item-in-dir",
            "diagnostics may reveal only the Tauri-managed log directory"
        );
        assert_eq!(
            permissions[7], "core:event:allow-listen",
            "the watcher subscription needs the event listen permission"
        );
        assert_eq!(
            permissions[8], "core:event:allow-unlisten",
            "the watcher subscription needs the event unlisten permission"
        );
        assert!(
            !raw.contains("opener:default"),
            "the broad opener:default permission must never be granted"
        );

        let allow = permissions[1]["allow"]
            .as_array()
            .expect("opener:allow-open-url must carry an allow list");
        let urls: Vec<&str> = allow
            .iter()
            .map(|entry| {
                entry["url"]
                    .as_str()
                    .expect("every allow entry must name a url")
            })
            .collect();
        assert_eq!(
            urls,
            [
                "https://steamcommunity.com/*",
                "https://api.steampowered.com/*",
                "steam:*",
            ],
            "the opener surface is scoped to the Steam scheme and the two Steam hosts"
        );

        let http_allow = permissions[2]["allow"]
            .as_array()
            .expect("http:default must carry an allow list");
        assert_eq!(
            http_allow,
            &[
                serde_json::json!({ "url": "http://localhost:3000/*" }),
                serde_json::json!({
                    "url": "https://launcher-api-production-e506.up.railway.app/*"
                }),
            ],
            "the HTTP surface is scoped to the local and production APIs"
        );
    }

    /// Cheap guard: the opener capability is only meaningful if the shell
    /// plugin never sneaks back in with a `shell:allow-execute`-style
    /// surface, and if the opener plugin dependency stays declared.
    #[test]
    fn the_crate_never_depends_on_the_shell_plugin() {
        let cargo_toml = include_str!("../Cargo.toml");

        assert!(
            !cargo_toml.contains("tauri-plugin-shell"),
            "the shell plugin must never be a dependency of the native runtime"
        );
        assert!(
            cargo_toml.contains("tauri-plugin-opener"),
            "the opener plugin dependency must stay declared"
        );
    }

    /// A discovery fake over fixture libraries, mirroring the port fakes of
    /// the scanner tests: the command-layer tests never touch the host
    /// Registry or the real disk layout.
    #[derive(Clone)]
    struct FakeDiscovery {
        libraries: Vec<SteamLibrary>,
    }

    impl LibraryDiscovery for FakeDiscovery {
        fn locate(&self) -> Result<Vec<SteamLibrary>, DiscoveryError> {
            Ok(self.libraries.clone())
        }
    }

    /// An opener fake that records the URIs it was asked to open.
    struct FakeOpener {
        opened: RefCell<Vec<String>>,
        fail: bool,
    }

    impl FakeOpener {
        fn default() -> Self {
            Self {
                opened: RefCell::new(Vec::new()),
                fail: false,
            }
        }

        fn failing() -> Self {
            Self {
                opened: RefCell::new(Vec::new()),
                fail: true,
            }
        }
    }

    impl ProtocolOpener for FakeOpener {
        fn open(&self, uri: &SteamUri) -> Result<(), GameActionError> {
            self.opened.borrow_mut().push(uri.as_str().to_string());
            if self.fail {
                Err(GameActionError::OpenFailed {
                    detail: "fake opener failure".to_string(),
                })
            } else {
                Ok(())
            }
        }
    }

    /// A temporary Steam library containing one fully installed game.
    ///
    /// Absolute paths only, per the crate-wide constraint from the locator
    /// tests. The fixture removes itself on drop.
    struct FixtureLibrary {
        root: PathBuf,
    }

    impl FixtureLibrary {
        fn with_installed_game(app_id: u32) -> Self {
            static COUNTER: AtomicU64 = AtomicU64::new(0);
            let root = std::env::temp_dir().join(format!(
                "fuse-launcher-command-test-{}-{}",
                std::process::id(),
                COUNTER.fetch_add(1, Ordering::Relaxed)
            ));
            let _ = std::fs::remove_dir_all(&root);
            let steamapps = root.join("steamapps");
            std::fs::create_dir_all(&steamapps).expect("create fixture steamapps dir");
            let manifest = format!(
                "\"AppState\"\n{{\n\t\"appid\"\t\t\"{app_id}\"\n\t\"name\"\t\t\"Counter-Strike 2\"\n\t\"StateFlags\"\t\t\"4\"\n\t\"installdir\"\t\t\"Counter-Strike_2\"\n}}\n"
            );
            std::fs::write(
                steamapps.join(format!("appmanifest_{app_id}.acf")),
                manifest,
            )
            .expect("write manifest fixture");
            std::fs::create_dir_all(steamapps.join("common").join("Counter-Strike_2"))
                .expect("create install dir fixture");
            Self { root }
        }

        fn library(&self) -> SteamLibrary {
            SteamLibrary::new(self.root.clone())
        }
    }

    impl Drop for FixtureLibrary {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.root);
        }
    }

    /// Builds the generic composition root over the fixture library, with an
    /// empty snapshot exactly as `run()` starts, an in-memory history, and
    /// the given opener.
    fn command_state(
        fixture: &FixtureLibrary,
        opener: FakeOpener,
    ) -> RuntimeState<FakeDiscovery, FakeOpener> {
        command_state_with(fixture, opener, LaunchHistoryStore::in_memory())
    }

    /// Like [`command_state`] but with the given history store, so a test
    /// can exercise persistence-failure paths deterministically.
    fn command_state_with(
        fixture: &FixtureLibrary,
        opener: FakeOpener,
        history: LaunchHistoryStore,
    ) -> RuntimeState<FakeDiscovery, FakeOpener> {
        let snapshot = Arc::new(Mutex::new(LocalLibrarySnapshot::new(
            Vec::new(),
            Vec::new(),
        )));
        let discovery = FakeDiscovery {
            libraries: vec![fixture.library()],
        };
        RuntimeState {
            snapshot: snapshot.clone(),
            scanner: ScanLocalLibrary::new(discovery.clone()),
            actions: GameActionService::new(SharedSnapshot::new(snapshot), opener),
            install_status: InstallStatusService::new(discovery),
            history,
        }
    }

    #[test]
    fn rejects_a_zero_app_id_from_every_game_command() {
        let fixture = FixtureLibrary::with_installed_game(730);
        let state = command_state(&fixture, FakeOpener::default());

        let expected = Err(CommandError {
            code: "invalid-app-id".to_string(),
            message: "the steam app id must be a positive number".to_string(),
        });
        assert_eq!(game_actions_launch_inner(&state, 0), expected);
        assert_eq!(game_actions_install_inner(&state, 0), expected);
        assert_eq!(
            tauri::async_runtime::block_on(game_actions_get_install_status_inner(&state, 0)),
            Err(CommandError {
                code: "invalid-app-id".to_string(),
                message: "the steam app id must be a positive number".to_string(),
            })
        );
        drop(fixture);
    }

    #[test]
    fn local_library_scan_writes_the_snapshot_and_returns_the_path_free_dto() {
        let fixture = FixtureLibrary::with_installed_game(730);
        let state = command_state(&fixture, FakeOpener::default());

        let dto = tauri::async_runtime::block_on(local_library_scan_inner(&state)).unwrap();

        assert_eq!(
            dto,
            LocalSnapshotDto {
                games: vec![LocalGameDto {
                    provider: ProviderDto::Steam,
                    external_game_id: 730,
                    name: "Counter-Strike 2".to_string(),
                    state: LocalInstallStateDto::Installed,
                }],
                diagnostics: Vec::new(),
            }
        );
        // The scan result becomes the shared snapshot the action service
        // reads on every launch.
        let snapshot = state.snapshot.lock().unwrap();
        assert_eq!(
            snapshot
                .find(SteamAppId::new(730).unwrap())
                .unwrap()
                .state(),
            LocalInstallState::Installed
        );
        drop(fixture);
    }

    #[test]
    fn launch_checks_the_snapshot_written_by_the_scan() {
        let fixture = FixtureLibrary::with_installed_game(730);
        let state = command_state(&fixture, FakeOpener::default());

        // Before any scan the snapshot is empty, so the game is refused.
        assert_eq!(
            game_actions_launch_inner(&state, 730),
            Err(CommandError {
                code: "game-not-installed".to_string(),
                message: "the game is not in the local installed snapshot".to_string(),
            })
        );

        tauri::async_runtime::block_on(local_library_scan_inner(&state)).unwrap();

        assert_eq!(
            game_actions_launch_inner(&state, 730),
            Ok(ActionAcceptedDto { accepted: true })
        );
        assert_eq!(
            state.actions.opener.opened.borrow().as_slice(),
            &["steam://rungameid/730"]
        );

        // A game absent from the scanned snapshot is still refused.
        assert_eq!(
            game_actions_launch_inner(&state, 570),
            Err(CommandError {
                code: "game-not-installed".to_string(),
                message: "the game is not in the local installed snapshot".to_string(),
            })
        );
        drop(fixture);
    }

    #[test]
    fn install_opens_the_install_uri_and_records_the_request() {
        let fixture = FixtureLibrary::with_installed_game(730);
        let state = command_state(&fixture, FakeOpener::default());

        assert_eq!(
            game_actions_install_inner(&state, 730),
            Ok(ActionAcceptedDto { accepted: true })
        );
        assert_eq!(
            state.actions.opener.opened.borrow().as_slice(),
            &["steam://install/730"]
        );
        assert!(state
            .actions
            .tracker
            .requested(SteamAppId::new(730).unwrap()));
        drop(fixture);
    }

    #[test]
    fn install_records_the_request_before_the_uri_is_opened() {
        let fixture = FixtureLibrary::with_installed_game(730);
        let state = command_state(&fixture, FakeOpener::failing());

        assert_eq!(
            game_actions_install_inner(&state, 730),
            Err(CommandError {
                code: "open-failed".to_string(),
                message: "could not open the steam url: fake opener failure".to_string(),
            })
        );
        // The request is recorded before the URI is opened, so an opener
        // failure never loses the fact that an install was requested.
        assert!(state
            .actions
            .tracker
            .requested(SteamAppId::new(730).unwrap()));
        drop(fixture);
    }

    #[test]
    fn install_status_refresh_reads_the_manifest_of_the_requested_game() {
        let fixture = FixtureLibrary::with_installed_game(730);
        let state = command_state(&fixture, FakeOpener::default());

        assert_eq!(
            tauri::async_runtime::block_on(game_actions_get_install_status_inner(&state, 730))
                .unwrap(),
            InstallStatusDto {
                state: InstallStatusStateDto::Installed
            }
        );
        assert_eq!(
            tauri::async_runtime::block_on(game_actions_get_install_status_inner(&state, 999))
                .unwrap(),
            InstallStatusDto {
                state: InstallStatusStateDto::Unknown
            }
        );
        drop(fixture);
    }

    /// A completed launch records the instant of the last launch for that
    /// entry; a refused launch records nothing.
    #[test]
    fn launch_records_the_instant_of_a_completed_launch_only_on_success() {
        let fixture = FixtureLibrary::with_installed_game(730);
        let state = command_state(&fixture, FakeOpener::default());

        tauri::async_runtime::block_on(local_library_scan_inner(&state)).unwrap();
        assert_eq!(
            game_actions_launch_inner(&state, 730),
            Ok(ActionAcceptedDto { accepted: true })
        );

        let history = state.history.entries();
        assert_eq!(history.entries.len(), 1);
        assert_eq!(history.entries[0].provider, ProviderDto::Steam);
        assert_eq!(history.entries[0].external_game_id, 730);
        assert!(
            is_iso_utc(&history.entries[0].last_launched_at),
            "the recorded instant must be an ISO 8601 UTC timestamp, got {}",
            history.entries[0].last_launched_at
        );

        // A refused launch must never be recorded as a completed launch.
        assert_eq!(
            game_actions_launch_inner(&state, 570),
            Err(CommandError {
                code: "game-not-installed".to_string(),
                message: "the game is not in the local installed snapshot".to_string(),
            })
        );
        assert_eq!(
            state.history.entries().entries.len(),
            1,
            "a failed launch must not touch the history"
        );
        drop(fixture);
    }

    /// The launch-history command serves the recorded entries to the
    /// frontend; an empty store reports an empty history.
    #[test]
    fn launch_history_get_returns_the_recorded_local_entries() {
        let fixture = FixtureLibrary::with_installed_game(730);
        let state = command_state(&fixture, FakeOpener::default());

        assert_eq!(launch_history_get_inner(&state).entries, Vec::new());

        tauri::async_runtime::block_on(local_library_scan_inner(&state)).unwrap();
        game_actions_launch_inner(&state, 730).unwrap();

        let history = launch_history_get_inner(&state);
        assert_eq!(history.entries.len(), 1);
        assert_eq!(history.entries[0].external_game_id, 730);
        assert!(is_iso_utc(&history.entries[0].last_launched_at));
        drop(fixture);
    }

    /// A persistence failure must never fail the launch: the record is
    /// logged and the action still succeeds.
    #[test]
    fn a_failed_history_record_never_fails_the_launch() {
        let fixture = FixtureLibrary::with_installed_game(730);
        // A directory at the history path makes the atomic rename fail
        // deterministically on every platform.
        let blocked = fixture.root.join("launch_history.json");
        std::fs::create_dir_all(&blocked).expect("create blocking history dir");
        let state = command_state_with(
            &fixture,
            FakeOpener::default(),
            LaunchHistoryStore::load(blocked.clone()),
        );

        tauri::async_runtime::block_on(local_library_scan_inner(&state)).unwrap();
        assert_eq!(
            game_actions_launch_inner(&state, 730),
            Ok(ActionAcceptedDto { accepted: true }),
            "a failed history write must never fail the launch"
        );
        // The in-memory record survives even when the write failed.
        assert_eq!(state.history.entries().entries.len(), 1);
        drop(fixture);
    }

    /// The default capability must grant the event listen/unlisten surface
    /// (the watcher subscription) next to the restricted opener and HTTP
    /// surfaces.
    fn is_iso_utc(value: &str) -> bool {
        value.len() == 20
            && value.ends_with('Z')
            && value.as_bytes()[4] == b'-'
            && value.as_bytes()[7] == b'-'
            && value.as_bytes()[10] == b'T'
            && value.as_bytes()[13] == b':'
            && value.as_bytes()[16] == b':'
    }
}
