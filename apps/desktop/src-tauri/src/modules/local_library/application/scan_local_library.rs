//! Use case: scan declared Steam libraries for installed-game manifests.
//!
//! The scan reads only `appmanifest_<appid>.acf` files inside the declared
//! libraries' `steamapps` directories; it never scans the whole disk.
//!
//! [`ScanLocalLibrary::execute`] is a plain blocking call returning a
//! `Result`, so the Tauri command layer can run it on the async runtime or
//! a worker thread (for example `tauri::async_runtime::spawn_blocking`) and
//! the UI thread never blocks on filesystem I/O.

use crate::modules::local_library::infrastructure::app_manifest_reader::ManifestRead;
use crate::modules::local_library::{
    AppManifestReader, DiscoveryError, LocalLibrarySnapshot, ScanDiagnostic, SteamLibrary,
};

/// Port for discovering the declared Steam libraries of this machine.
///
/// [`SteamLibraryLocator`] implements this port; tests use fakes so scans
/// never touch the Windows Registry or the host filesystem layout.
///
/// [`SteamLibraryLocator`]: crate::modules::local_library::infrastructure::steam_library_locator::SteamLibraryLocator
pub trait LibraryDiscovery {
    /// Locates every usable Steam library on this machine.
    fn locate(&self) -> Result<Vec<SteamLibrary>, DiscoveryError>;
}

/// Scans every declared Steam library for installed-game manifests.
#[derive(Clone)]
pub struct ScanLocalLibrary<L: LibraryDiscovery> {
    locator: L,
}

impl<L: LibraryDiscovery> ScanLocalLibrary<L> {
    /// Creates the scanner over the given library discovery port.
    pub fn new(locator: L) -> Self {
        Self { locator }
    }

    /// Reads the manifests of every declared library and builds a local
    /// snapshot.
    ///
    /// A malformed manifest is skipped and recorded as a diagnostic; a
    /// library whose `steamapps` directory cannot be read is recorded as a
    /// diagnostic naming the library. Neither aborts the rest of the scan.
    /// Returns [`DiscoveryError::SteamNotFound`] when no usable library
    /// exists.
    pub fn execute(&self) -> Result<LocalLibrarySnapshot, DiscoveryError> {
        log::info!("library scan started");
        let libraries = self.locator.locate()?;
        let mut games = Vec::new();
        let mut diagnostics = Vec::new();
        let reader = AppManifestReader;

        for library in &libraries {
            let steamapps = library.steamapps();
            let entries = match std::fs::read_dir(&steamapps) {
                Ok(entries) => entries,
                Err(_) => {
                    let library_name = library
                        .root()
                        .file_name()
                        .map(|name| name.to_string_lossy().into_owned())
                        .unwrap_or_else(|| "unknown".to_string());
                    diagnostics.push(ScanDiagnostic {
                        manifest: String::new(),
                        message: format!(
                            "steamapps directory of library {library_name:?} could not be read"
                        ),
                    });
                    continue;
                }
            };
            // Entry-level `read_dir` errors (a file deleted mid-scan, a
            // permissions race) are intentionally dropped by `flatten`:
            // they are transient and the entry simply contributes no game.
            // Manifest-level problems are recorded as diagnostics instead.
            for entry in entries.flatten() {
                match reader.read(&steamapps, &entry.file_name()) {
                    ManifestRead::Skipped => {}
                    ManifestRead::Game { game, diagnostic } => {
                        games.push(game);
                        if let Some(diagnostic) = diagnostic {
                            diagnostics.push(diagnostic);
                        }
                    }
                    ManifestRead::Invalid(diagnostic) => diagnostics.push(diagnostic),
                }
            }
        }

        let snapshot = LocalLibrarySnapshot::new(games, diagnostics);
        log::info!(
            "library scan finished: libraries={} games={} diagnostics={}",
            libraries.len(),
            snapshot.games().len(),
            snapshot.diagnostics().len()
        );
        // Diagnostics carry only the manifest file name and a short reason,
        // never an absolute path.
        for diagnostic in snapshot.diagnostics() {
            log::warn!(
                "scan diagnostic: manifest {}: {}",
                diagnostic.manifest,
                diagnostic.message
            );
        }
        Ok(snapshot)
    }
}

#[cfg(test)]
mod tests {
    use super::{LibraryDiscovery, ScanLocalLibrary};
    use crate::modules::local_library::domain::local_game::{LocalInstallState, SteamAppId};
    use crate::modules::local_library::domain::steam_path::{DiscoveryError, SteamLibrary};
    use std::path::PathBuf;
    use std::sync::atomic::{AtomicU64, Ordering};

    #[test]
    fn returns_only_valid_steam_manifests_from_declared_libraries() {
        let fixture = fixture_library_with_manifests(&[
            ("appmanifest_730.acf", "Counter-Strike 2", "4"),
            ("appmanifest_570.acf", "Dota 2", "1026"),
            ("appmanifest_bad.acf", "ignored", "4"),
        ]);
        let scanner = ScanLocalLibrary::new(FakeSteamLibraryLocator::from(fixture));

        let snapshot = scanner.execute().unwrap();

        assert_eq!(snapshot.games().len(), 2);
        assert_eq!(
            snapshot
                .find(SteamAppId::new(730).unwrap())
                .unwrap()
                .state(),
            LocalInstallState::Installed
        );
    }

    #[test]
    fn reports_installing_while_the_manifest_state_is_incomplete() {
        let fixture = fixture_library_with_manifests(&[("appmanifest_570.acf", "Dota 2", "1026")]);
        let scanner = ScanLocalLibrary::new(FakeSteamLibraryLocator::from(fixture));

        let snapshot = scanner.execute().unwrap();

        assert_eq!(
            snapshot
                .find(SteamAppId::new(570).unwrap())
                .unwrap()
                .state(),
            LocalInstallState::Installing
        );
    }

    #[test]
    fn reports_installing_when_the_install_directory_is_missing() {
        let fixture = fixture_library_with_manifests(&[]).with_raw_manifest(
            "appmanifest_123.acf",
            "\"AppState\"\n{\n\t\"appid\"\t\t\"123\"\n\t\"name\"\t\t\"Missing Dir\"\n\t\"StateFlags\"\t\t\"4\"\n\t\"installdir\"\t\t\"missing-dir\"\n}\n",
        );
        let scanner = ScanLocalLibrary::new(FakeSteamLibraryLocator::from(fixture));

        let snapshot = scanner.execute().unwrap();

        assert_eq!(
            snapshot
                .find(SteamAppId::new(123).unwrap())
                .unwrap()
                .state(),
            LocalInstallState::Installing
        );
    }

    #[test]
    fn keeps_a_game_with_unknown_state_when_state_flags_are_missing() {
        let fixture = fixture_library_with_manifests(&[]).with_raw_manifest(
            "appmanifest_321.acf",
            "\"AppState\"\n{\n\t\"appid\"\t\t\"321\"\n\t\"name\"\t\t\"No Flags\"\n\t\"installdir\"\t\t\"no-flags\"\n}\n",
        );
        let scanner = ScanLocalLibrary::new(FakeSteamLibraryLocator::from(fixture));

        let snapshot = scanner.execute().unwrap();

        assert_eq!(
            snapshot
                .find(SteamAppId::new(321).unwrap())
                .unwrap()
                .state(),
            LocalInstallState::Unknown
        );
        assert_eq!(snapshot.diagnostics().len(), 1);
        assert_eq!(snapshot.diagnostics()[0].manifest, "appmanifest_321.acf");
    }

    #[test]
    fn skips_malformed_manifests_but_keeps_valid_games_and_records_diagnostics() {
        let fixture =
            fixture_library_with_manifests(&[("appmanifest_730.acf", "Counter-Strike 2", "4")])
                .with_raw_manifest("appmanifest_999.acf", "not a valve keyvalues file");
        let scanner = ScanLocalLibrary::new(FakeSteamLibraryLocator::from(fixture));

        let snapshot = scanner.execute().unwrap();

        assert_eq!(snapshot.games().len(), 1);
        assert_eq!(snapshot.diagnostics().len(), 1);
        assert_eq!(snapshot.diagnostics()[0].manifest, "appmanifest_999.acf");
        assert!(snapshot.find(SteamAppId::new(999).unwrap()).is_none());
    }

    #[test]
    fn skips_a_manifest_whose_appid_mismatches_its_file_name() {
        let fixture = fixture_library_with_manifests(&[]).with_raw_manifest(
            "appmanifest_997.acf",
            "\"AppState\"\n{\n\t\"appid\"\t\t\"998\"\n\t\"name\"\t\t\"Renamed\"\n\t\"StateFlags\"\t\t\"4\"\n\t\"installdir\"\t\t\"renamed\"\n}\n",
        );
        let scanner = ScanLocalLibrary::new(FakeSteamLibraryLocator::from(fixture));

        let snapshot = scanner.execute().unwrap();

        assert!(snapshot.games().is_empty());
        assert_eq!(snapshot.diagnostics().len(), 1);
        assert_eq!(snapshot.diagnostics()[0].manifest, "appmanifest_997.acf");
    }

    #[test]
    fn skips_a_manifest_whose_installdir_is_not_a_plain_directory_name() {
        for installdir in ["", ".", ".."] {
            let fixture = fixture_library_with_manifests(&[]).with_raw_manifest(
                "appmanifest_456.acf",
                &format!(
                    "\"AppState\"\n{{\n\t\"appid\"\t\t\"456\"\n\t\"name\"\t\t\"Bad Dir\"\n\t\"StateFlags\"\t\t\"4\"\n\t\"installdir\"\t\t\"{installdir}\"\n}}\n"
                ),
            );
            // The `common` directory exists, so an accepted bad installdir
            // would resolve to an existing directory and report a false
            // `Installed` instead of being skipped.
            std::fs::create_dir_all(fixture.root.join("steamapps").join("common"))
                .expect("create common dir fixture");
            let scanner = ScanLocalLibrary::new(FakeSteamLibraryLocator::from(fixture));

            let snapshot = scanner.execute().unwrap();

            assert!(
                snapshot.games().is_empty(),
                "installdir {installdir:?} must not be accepted"
            );
            assert_eq!(snapshot.diagnostics().len(), 1);
            assert_eq!(snapshot.diagnostics()[0].manifest, "appmanifest_456.acf");
        }
    }

    #[test]
    fn reads_the_committed_570_fixture_as_an_installing_game() {
        let fixture = fixture_library_with_manifests(&[]).with_raw_manifest(
            "appmanifest_570.acf",
            include_str!("../../../../tests/fixtures/appmanifest_570.acf"),
        );
        let scanner = ScanLocalLibrary::new(FakeSteamLibraryLocator::from(fixture));

        let snapshot = scanner.execute().unwrap();

        let game = snapshot.find(SteamAppId::new(570).unwrap()).unwrap();
        assert_eq!(game.name(), "Dota 2");
        assert_eq!(game.state(), LocalInstallState::Installing);
        assert!(snapshot.diagnostics().is_empty());
    }

    #[test]
    fn keeps_a_game_with_unknown_state_when_state_flags_are_not_numeric() {
        let fixture = fixture_library_with_manifests(&[]).with_raw_manifest(
            "appmanifest_654.acf",
            "\"AppState\"\n{\n\t\"appid\"\t\t\"654\"\n\t\"name\"\t\t\"Weird Flags\"\n\t\"StateFlags\"\t\t\"abc\"\n\t\"installdir\"\t\t\"weird-flags\"\n}\n",
        );
        let scanner = ScanLocalLibrary::new(FakeSteamLibraryLocator::from(fixture));

        let snapshot = scanner.execute().unwrap();

        assert_eq!(
            snapshot
                .find(SteamAppId::new(654).unwrap())
                .unwrap()
                .state(),
            LocalInstallState::Unknown
        );
        assert_eq!(snapshot.diagnostics().len(), 1);
        assert!(snapshot.diagnostics()[0].message.contains("state flags"));
    }

    #[cfg(unix)]
    #[test]
    fn skips_a_manifest_file_that_cannot_be_read() {
        use std::os::unix::fs::PermissionsExt;

        let fixture = fixture_library_with_manifests(&[]).with_raw_manifest(
            "appmanifest_777.acf",
            "\"AppState\"\n{\n\t\"appid\"\t\t\"777\"\n\t\"name\"\t\t\"Locked\"\n\t\"StateFlags\"\t\t\"4\"\n\t\"installdir\"\t\t\"locked\"\n}\n",
        );
        let manifest_path = fixture.root.join("steamapps").join("appmanifest_777.acf");
        std::fs::set_permissions(&manifest_path, std::fs::Permissions::from_mode(0o000))
            .expect("lock the manifest file");

        let scanner = ScanLocalLibrary::new(FakeSteamLibraryLocator::from(fixture));
        let snapshot = scanner.execute().unwrap();

        assert!(snapshot.games().is_empty());
        assert_eq!(snapshot.diagnostics().len(), 1);
        assert_eq!(snapshot.diagnostics()[0].manifest, "appmanifest_777.acf");
        assert!(snapshot.diagnostics()[0]
            .message
            .contains("could not be read"));
    }

    #[test]
    fn reports_a_library_whose_steamapps_cannot_be_read_but_keeps_scanning() {
        let good =
            fixture_library_with_manifests(&[("appmanifest_730.acf", "Counter-Strike 2", "4")]);
        let broken = fixture_library_with_manifests(&[]);
        // Replacing the steamapps directory with a file makes read_dir fail
        // deterministically on every platform.
        std::fs::remove_dir_all(broken.root.join("steamapps")).unwrap();
        std::fs::write(broken.root.join("steamapps"), "not a directory").unwrap();
        let broken_root_name = broken
            .root
            .file_name()
            .unwrap()
            .to_string_lossy()
            .into_owned();
        let locator = FakeSteamLibraryLocator {
            libraries: vec![
                SteamLibrary::new(broken.root.clone()),
                SteamLibrary::new(good.root.clone()),
            ],
            _fixtures: vec![broken, good],
        };

        let snapshot = ScanLocalLibrary::new(locator).execute().unwrap();

        assert_eq!(snapshot.games().len(), 1);
        assert_eq!(snapshot.diagnostics().len(), 1);
        let diagnostic = &snapshot.diagnostics()[0];
        assert!(
            diagnostic.message.contains(&broken_root_name),
            "diagnostic should name the unreadable library: {}",
            diagnostic.message
        );
    }

    #[test]
    fn returns_an_empty_snapshot_when_libraries_have_no_manifests() {
        let fixture = fixture_library_with_manifests(&[]);
        let scanner = ScanLocalLibrary::new(FakeSteamLibraryLocator::from(fixture));

        let snapshot = scanner.execute().unwrap();

        assert!(snapshot.games().is_empty());
        assert!(snapshot.find(SteamAppId::new(730).unwrap()).is_none());
    }

    #[test]
    fn rejects_zero_as_an_app_id() {
        assert!(SteamAppId::new(0).is_err());
        assert_eq!(
            SteamAppId::new(0),
            Err(crate::modules::local_library::domain::local_game::SteamAppIdError::ZeroNotAllowed)
        );
    }

    /// A temporary Steam library written under the system temp directory.
    ///
    /// Absolute paths only: the crate-wide constraint from the locator tests
    /// forbids bare relative runtime I/O (the CWD_LOCK-guarded helper chdirs
    /// process-wide). This fixture never changes the working directory and
    /// removes itself on drop.
    struct FixtureLibrary {
        root: PathBuf,
    }

    impl FixtureLibrary {
        /// Writes one manifest per `(file_name, name, state_flags)` tuple and
        /// creates the matching `<steamapps>/common/<installdir>` directory,
        /// so a `StateFlags` of `4` resolves to `Installed`.
        fn with_manifests(self, manifests: &[(&str, &str, &str)]) -> Self {
            let steamapps = self.root.join("steamapps");
            for (file_name, name, state_flags) in manifests {
                let app_id = file_name
                    .strip_prefix("appmanifest_")
                    .and_then(|rest| rest.strip_suffix(".acf"))
                    .expect("manifest fixture file name must be appmanifest_<appid>.acf");
                let install_dir_name = name.replace(' ', "_");
                let manifest = format!(
                    "\"AppState\"\n{{\n\t\"appid\"\t\t\"{app_id}\"\n\t\"name\"\t\t\"{name}\"\n\t\"StateFlags\"\t\t\"{state_flags}\"\n\t\"installdir\"\t\t\"{install_dir_name}\"\n}}\n"
                );
                std::fs::write(steamapps.join(file_name), manifest)
                    .expect("write manifest fixture");
                std::fs::create_dir_all(steamapps.join("common").join(&install_dir_name))
                    .expect("create install dir fixture");
            }
            self
        }

        /// Writes a raw manifest file verbatim, without creating any install
        /// directory (used by malformed-manifest tests).
        fn with_raw_manifest(self, file_name: &str, content: &str) -> Self {
            std::fs::write(self.root.join("steamapps").join(file_name), content)
                .expect("write raw manifest fixture");
            self
        }
    }

    impl Drop for FixtureLibrary {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.root);
        }
    }

    /// Creates a fixture library with the given generated manifests.
    fn fixture_library_with_manifests(manifests: &[(&str, &str, &str)]) -> FixtureLibrary {
        static COUNTER: AtomicU64 = AtomicU64::new(0);
        let root = std::env::temp_dir().join(format!(
            "launcher-scan-test-{}-{}",
            std::process::id(),
            COUNTER.fetch_add(1, Ordering::Relaxed)
        ));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(root.join("steamapps")).expect("create fixture steamapps dir");
        FixtureLibrary { root }.with_manifests(manifests)
    }

    /// A library discovery fake reporting the fixture libraries.
    struct FakeSteamLibraryLocator {
        libraries: Vec<SteamLibrary>,
        _fixtures: Vec<FixtureLibrary>,
    }

    impl From<FixtureLibrary> for FakeSteamLibraryLocator {
        fn from(fixture: FixtureLibrary) -> Self {
            let library = SteamLibrary::new(fixture.root.clone());
            Self {
                libraries: vec![library],
                _fixtures: vec![fixture],
            }
        }
    }

    impl LibraryDiscovery for FakeSteamLibraryLocator {
        fn locate(&self) -> Result<Vec<SteamLibrary>, DiscoveryError> {
            Ok(self.libraries.clone())
        }
    }
}
