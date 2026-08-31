//! Use case: report the observable installation state of a single game.
//!
//! The service rescans *only* the known manifest of the requested AppID:
//! it locates the declared Steam libraries, then reads the single
//! `appmanifest_<app_id>.acf` file — no directory listing and no new disk
//! scans beyond the known manifest. It never claims a download percentage.

use crate::modules::game_actions::domain::install_status::{GameActionError, InstallStatus};
use crate::modules::local_library::application::scan_local_library::LibraryDiscovery;
use crate::modules::local_library::domain::local_game::{LocalInstallState, SteamAppId};
use crate::modules::local_library::infrastructure::app_manifest_reader::{
    AppManifestReader, ManifestRead,
};
use std::ffi::OsStr;

/// Reports the installation state of a single game from its manifest.
#[derive(Debug, Clone)]
pub struct InstallStatusService<L: LibraryDiscovery> {
    locator: L,
    reader: AppManifestReader,
}

impl<L: LibraryDiscovery> InstallStatusService<L> {
    /// Creates the service over the given library discovery port.
    pub fn new(locator: L) -> Self {
        Self {
            locator,
            reader: AppManifestReader,
        }
    }

    /// Returns the installation state of `app_id`.
    ///
    /// `Installed` when the manifest reports a complete install and the
    /// install directory exists; `Installing` when a manifest exists but is
    /// incomplete; `Unknown` when the Steam path cannot be verified or no
    /// library holds a verifiable manifest for the game. A manifest that
    /// cannot be parsed in one library does not mask a valid manifest for
    /// the same AppID in a later library.
    pub fn get(&self, app_id: SteamAppId) -> Result<InstallStatus, GameActionError> {
        let libraries = match self.locator.locate() {
            Ok(libraries) => libraries,
            // The Steam path cannot be verified on this machine.
            Err(error) => {
                log::warn!(
                    "install status: steam not found for app id {}: {error}",
                    app_id.as_u32()
                );
                return Ok(InstallStatus::Unknown);
            }
        };
        let manifest_name = format!("appmanifest_{}.acf", app_id.as_u32());
        let manifest_name = OsStr::new(&manifest_name);

        for library in libraries {
            match self.reader.read(&library.steamapps(), manifest_name) {
                ManifestRead::Game { game, .. } => {
                    let state = match game.state() {
                        LocalInstallState::Installed => InstallStatus::Installed,
                        LocalInstallState::Installing => InstallStatus::Installing,
                        LocalInstallState::Unknown => InstallStatus::Unknown,
                    };
                    log::debug!("install status: app id {} state {state:?}", app_id.as_u32());
                    return Ok(state);
                }
                // A manifest that exists but cannot be parsed is unverifiable
                // in *this* library; a later library may hold a valid
                // manifest for the same AppID, so keep scanning.
                ManifestRead::Invalid(_) => {}
                ManifestRead::Skipped => {}
            }
        }

        log::debug!("install status: app id {} state Unknown", app_id.as_u32());
        Ok(InstallStatus::Unknown)
    }
}

#[cfg(test)]
mod tests {
    use super::InstallStatusService;
    use crate::modules::game_actions::domain::install_status::InstallStatus;
    use crate::modules::local_library::application::scan_local_library::LibraryDiscovery;
    use crate::modules::local_library::domain::local_game::SteamAppId;
    use crate::modules::local_library::domain::steam_path::{DiscoveryError, SteamLibrary};
    use std::path::PathBuf;
    use std::sync::atomic::{AtomicU64, Ordering};

    /// A discovery fake reporting the given libraries, or no Steam at all.
    struct FakeDiscovery {
        libraries: Vec<SteamLibrary>,
    }

    impl FakeDiscovery {
        fn with(libraries: Vec<SteamLibrary>) -> Self {
            Self { libraries }
        }
    }

    impl LibraryDiscovery for FakeDiscovery {
        fn locate(&self) -> Result<Vec<SteamLibrary>, DiscoveryError> {
            Ok(self.libraries.clone())
        }
    }

    /// A discovery fake reporting that Steam itself cannot be found.
    struct NoSteam;

    impl LibraryDiscovery for NoSteam {
        fn locate(&self) -> Result<Vec<SteamLibrary>, DiscoveryError> {
            Err(DiscoveryError::SteamNotFound)
        }
    }

    /// A temporary Steam library written under the system temp directory.
    ///
    /// Absolute paths only, per the crate-wide constraint from the locator
    /// tests: the crate never does bare relative runtime I/O. The fixture
    /// removes itself on drop.
    struct FixtureLibrary {
        root: PathBuf,
    }

    impl FixtureLibrary {
        fn new() -> Self {
            static COUNTER: AtomicU64 = AtomicU64::new(0);
            let root = std::env::temp_dir().join(format!(
                "fuse-launcher-install-status-test-{}-{}",
                std::process::id(),
                COUNTER.fetch_add(1, Ordering::Relaxed)
            ));
            let _ = std::fs::remove_dir_all(&root);
            std::fs::create_dir_all(root.join("steamapps")).expect("create fixture steamapps");
            Self { root }
        }

        fn library(&self) -> SteamLibrary {
            SteamLibrary::new(self.root.clone())
        }

        /// Writes a manifest whose `StateFlags` mark it complete, and
        /// creates the matching install directory, so it resolves to
        /// `Installed`.
        fn with_complete_manifest(self, app_id: u32, install_dir: &str) -> Self {
            let library = self.with_manifest(app_id, install_dir, "4");
            std::fs::create_dir_all(
                library
                    .root
                    .join("steamapps")
                    .join("common")
                    .join(install_dir),
            )
            .expect("create install dir fixture");
            library
        }

        /// Writes a manifest whose `StateFlags` mark it incomplete, with no
        /// install directory, so it resolves to `Installing`.
        fn with_incomplete_manifest(self, app_id: u32, install_dir: &str) -> Self {
            self.with_manifest(app_id, install_dir, "2")
        }

        /// Writes a raw manifest that fails to parse.
        fn with_corrupt_manifest(self, app_id: u32) -> Self {
            std::fs::write(
                self.root
                    .join("steamapps")
                    .join(format!("appmanifest_{app_id}.acf")),
                "not a valve keyvalues file",
            )
            .expect("write corrupt manifest fixture");
            self
        }

        /// Writes a manifest with the given `StateFlags` and no install
        /// directory.
        fn with_manifest(self, app_id: u32, install_dir: &str, state_flags: &str) -> Self {
            self.write_manifest(app_id, install_dir, state_flags);
            self
        }

        fn write_manifest(&self, app_id: u32, install_dir: &str, state_flags: &str) {
            let manifest = format!(
                "\"AppState\"\n{{\n\t\"appid\"\t\t\"{app_id}\"\n\t\"name\"\t\t\"Game\"\n\t\"StateFlags\"\t\t\"{state_flags}\"\n\t\"installdir\"\t\t\"{install_dir}\"\n}}\n"
            );
            std::fs::write(
                self.root
                    .join("steamapps")
                    .join(format!("appmanifest_{app_id}.acf")),
                manifest,
            )
            .expect("write manifest fixture");
        }
    }

    impl Drop for FixtureLibrary {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.root);
        }
    }

    fn service_for(fixture: &FixtureLibrary) -> InstallStatusService<FakeDiscovery> {
        InstallStatusService::new(FakeDiscovery::with(vec![fixture.library()]))
    }

    #[test]
    fn reports_unknown_when_steam_itself_cannot_be_verified() {
        let service = InstallStatusService::new(NoSteam);

        assert_eq!(
            service.get(SteamAppId::new(730).unwrap()).unwrap(),
            InstallStatus::Unknown
        );
    }

    #[test]
    fn reports_installed_when_the_manifest_is_complete_and_the_directory_exists() {
        let fixture = FixtureLibrary::new().with_complete_manifest(730, "Counter-Strike_2");
        let service = service_for(&fixture);

        assert_eq!(
            service.get(SteamAppId::new(730).unwrap()).unwrap(),
            InstallStatus::Installed
        );
        drop(fixture);
    }

    #[test]
    fn reports_installing_when_the_manifest_is_incomplete() {
        let fixture = FixtureLibrary::new().with_incomplete_manifest(730, "Counter-Strike_2");
        let service = service_for(&fixture);

        assert_eq!(
            service.get(SteamAppId::new(730).unwrap()).unwrap(),
            InstallStatus::Installing
        );
        drop(fixture);
    }

    #[test]
    fn reports_installing_when_the_install_directory_is_missing() {
        let fixture = FixtureLibrary::new().with_manifest(730, "Counter-Strike_2", "4");
        let service = service_for(&fixture);

        assert_eq!(
            service.get(SteamAppId::new(730).unwrap()).unwrap(),
            InstallStatus::Installing
        );
        drop(fixture);
    }

    #[test]
    fn reports_unknown_when_the_manifest_is_missing() {
        let fixture = FixtureLibrary::new();
        let service = service_for(&fixture);

        assert_eq!(
            service.get(SteamAppId::new(730).unwrap()).unwrap(),
            InstallStatus::Unknown
        );
        drop(fixture);
    }

    #[test]
    fn reports_unknown_when_the_manifest_cannot_be_parsed() {
        let fixture = FixtureLibrary::new().with_corrupt_manifest(730);
        let service = service_for(&fixture);

        assert_eq!(
            service.get(SteamAppId::new(730).unwrap()).unwrap(),
            InstallStatus::Unknown
        );
        drop(fixture);
    }

    #[test]
    fn continues_past_a_corrupt_manifest_in_one_library_to_a_valid_manifest() {
        let broken = FixtureLibrary::new().with_corrupt_manifest(730);
        let good = FixtureLibrary::new().with_complete_manifest(730, "Counter-Strike_2");
        let service =
            InstallStatusService::new(FakeDiscovery::with(vec![broken.library(), good.library()]));

        assert_eq!(
            service.get(SteamAppId::new(730).unwrap()).unwrap(),
            InstallStatus::Installed
        );
        drop(broken);
        drop(good);
    }

    #[test]
    fn reads_only_the_requested_manifest_and_ignores_other_games() {
        let fixture = FixtureLibrary::new()
            .with_complete_manifest(730, "Counter-Strike_2")
            .with_incomplete_manifest(570, "Dota_2");
        let service = service_for(&fixture);

        assert_eq!(
            service.get(SteamAppId::new(570).unwrap()).unwrap(),
            InstallStatus::Installing
        );
        drop(fixture);
    }
}
