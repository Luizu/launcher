//! Use case: safely launch or request the installation of Steam games.
//!
//! Launching requires the game to be `Installed` in the current local
//! snapshot; installing only requires a validated positive AppID and records
//! the request before the URI is opened. All URIs are constructed by
//! [`SteamUri`] inside Rust and handed to the [`ProtocolOpener`] port —
//! no arbitrary string ever reaches the opener.

use crate::modules::game_actions::domain::install_status::{ActionAccepted, GameActionError};
use crate::modules::game_actions::domain::steam_uri::SteamUri;
use crate::modules::local_library::domain::local_game::{LocalInstallState, SteamAppId};
use crate::modules::local_library::domain::local_library_snapshot::LocalLibrarySnapshot;
use std::collections::HashSet;
use std::sync::Mutex;

/// Port for reading the current local library snapshot.
///
/// The composition root wires a provider over the in-memory snapshot last
/// produced by `local_library_scan`, so actions always check the freshest
/// scan; tests use fixed fakes.
pub trait SnapshotProvider {
    /// The current snapshot of locally installed games.
    fn current(&self) -> LocalLibrarySnapshot;
}

/// Port for opening a validated `steam://` URI on this machine.
///
/// The concrete adapter uses the official Tauri opener plugin; tests use a
/// fake that records the opened URIs.
pub trait ProtocolOpener {
    /// Opens `uri` with the platform's Steam client handler.
    fn open(&self, uri: &SteamUri) -> Result<(), GameActionError>;
}

/// In-memory record of games the user asked Steam to install.
///
/// The request is recorded *before* the install URI is opened, so an opener
/// failure never loses the fact that an install was requested. The record
/// lives only in memory; installation state is never persisted.
#[derive(Debug, Default)]
pub struct InstallRequestTracker {
    requested: Mutex<HashSet<SteamAppId>>,
}

impl InstallRequestTracker {
    /// Records that Steam was asked to install `app_id`.
    pub fn record(&self, app_id: SteamAppId) {
        self.requested
            .lock()
            .expect("install request tracker poisoned")
            .insert(app_id);
    }

    /// Whether an install request was recorded for `app_id`.
    #[cfg(test)]
    pub fn requested(&self, app_id: SteamAppId) -> bool {
        self.requested
            .lock()
            .expect("install request tracker poisoned")
            .contains(&app_id)
    }
}

/// Executes launch and install actions against the local Steam installation.
///
/// The service is stateless apart from the install request tracker, so the
/// composition root can share one instance behind the Tauri managed state.
#[derive(Debug)]
pub struct GameActionService<S: SnapshotProvider, O: ProtocolOpener> {
    snapshot: S,
    /// Crate-internal so the command-layer tests can inspect opened URIs.
    pub(crate) opener: O,
    /// Crate-internal so the command-layer tests can verify install records.
    pub(crate) tracker: InstallRequestTracker,
}

impl<S: SnapshotProvider, O: ProtocolOpener> GameActionService<S, O> {
    /// Creates the service over the given snapshot provider and opener.
    pub fn new(snapshot: S, opener: O) -> Self {
        Self {
            snapshot,
            opener,
            tracker: InstallRequestTracker::default(),
        }
    }

    /// Launches `app_id` when the current snapshot reports it as
    /// `Installed`.
    ///
    /// Refuses with [`GameActionError::GameNotInstalled`] when the game is
    /// absent from the snapshot or not fully installed; the snapshot is
    /// consulted before any URI is built or opened.
    pub fn launch(&self, app_id: SteamAppId) -> Result<ActionAccepted, GameActionError> {
        let installed = self
            .snapshot
            .current()
            .find(app_id)
            .map(|game| game.state() == LocalInstallState::Installed)
            .unwrap_or(false);
        if !installed {
            return Err(GameActionError::GameNotInstalled);
        }
        self.opener.open(&SteamUri::launch(app_id))?;
        Ok(ActionAccepted)
    }

    /// Requests Steam to install `app_id`.
    ///
    /// Records `install-requested` in the tracker *before* opening the URI,
    /// then opens `steam://install/<app_id>`.
    pub fn install(&self, app_id: SteamAppId) -> Result<ActionAccepted, GameActionError> {
        self.tracker.record(app_id);
        self.opener.open(&SteamUri::install(app_id))?;
        Ok(ActionAccepted)
    }
}

#[cfg(test)]
mod tests {
    use super::{GameActionService, ProtocolOpener, SnapshotProvider, SteamUri};
    use crate::modules::game_actions::domain::install_status::{ActionAccepted, GameActionError};
    use crate::modules::local_library::domain::local_game::{
        LocalGame, LocalInstallState, Provider, SteamAppId,
    };
    use crate::modules::local_library::domain::local_library_snapshot::LocalLibrarySnapshot;
    use std::cell::RefCell;

    struct FakeSnapshot {
        games: Vec<LocalGame>,
    }

    impl FakeSnapshot {
        fn empty() -> Self {
            Self { games: Vec::new() }
        }

        fn with_games(games: Vec<LocalGame>) -> Self {
            Self { games }
        }

        fn installed(app_id: SteamAppId) -> Self {
            Self::with_games(vec![LocalGame::new(
                Provider::Steam,
                app_id,
                "Counter-Strike 2".to_string(),
                LocalInstallState::Installed,
            )])
        }
    }

    impl SnapshotProvider for FakeSnapshot {
        fn current(&self) -> LocalLibrarySnapshot {
            LocalLibrarySnapshot::new(self.games.clone(), Vec::new())
        }
    }

    struct FakeProtocolOpener {
        opened: RefCell<Vec<String>>,
        fail: bool,
    }

    impl FakeProtocolOpener {
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

    impl ProtocolOpener for FakeProtocolOpener {
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

    #[test]
    fn refuses_to_launch_a_game_not_in_the_installed_snapshot() {
        let opener = FakeProtocolOpener::default();
        let service = GameActionService::new(FakeSnapshot::empty(), opener);

        assert!(matches!(
            service.launch(SteamAppId::new(730).unwrap()),
            Err(GameActionError::GameNotInstalled)
        ));
    }

    #[test]
    fn refuses_to_launch_a_game_that_is_not_fully_installed() {
        let snapshot = FakeSnapshot::with_games(vec![LocalGame::new(
            Provider::Steam,
            SteamAppId::new(730).unwrap(),
            "Counter-Strike 2".to_string(),
            LocalInstallState::Installing,
        )]);
        let service = GameActionService::new(snapshot, FakeProtocolOpener::default());

        assert!(matches!(
            service.launch(SteamAppId::new(730).unwrap()),
            Err(GameActionError::GameNotInstalled)
        ));
        assert!(service.opener.opened.borrow().is_empty());
    }

    #[test]
    fn launches_an_installed_game_and_opens_the_run_uri() {
        let service = GameActionService::new(
            FakeSnapshot::installed(SteamAppId::new(730).unwrap()),
            FakeProtocolOpener::default(),
        );

        let accepted = service.launch(SteamAppId::new(730).unwrap()).unwrap();

        assert!(matches!(accepted, ActionAccepted));
        assert_eq!(
            service.opener.opened.borrow().as_slice(),
            &["steam://rungameid/730"]
        );
    }

    #[test]
    fn install_opens_the_install_uri_and_records_the_request() {
        let service = GameActionService::new(FakeSnapshot::empty(), FakeProtocolOpener::default());

        let accepted = service.install(SteamAppId::new(730).unwrap()).unwrap();

        assert!(matches!(accepted, ActionAccepted));
        assert_eq!(
            service.opener.opened.borrow().as_slice(),
            &["steam://install/730"]
        );
        assert!(service.tracker.requested(SteamAppId::new(730).unwrap()));
    }

    #[test]
    fn records_the_install_request_even_when_the_opener_fails() {
        let service = GameActionService::new(FakeSnapshot::empty(), FakeProtocolOpener::failing());

        assert!(matches!(
            service.install(SteamAppId::new(730).unwrap()),
            Err(GameActionError::OpenFailed { .. })
        ));
        // The request is recorded before the URI is opened, so an opener
        // failure never loses the fact that an install was requested.
        assert!(service.tracker.requested(SteamAppId::new(730).unwrap()));
    }

    #[test]
    fn does_not_open_anything_when_the_snapshot_has_no_games() {
        let service = GameActionService::new(FakeSnapshot::empty(), FakeProtocolOpener::default());

        let _ = service.launch(SteamAppId::new(570).unwrap());

        assert!(service.opener.opened.borrow().is_empty());
    }
}
