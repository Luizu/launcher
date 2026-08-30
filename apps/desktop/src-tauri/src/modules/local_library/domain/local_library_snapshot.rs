//! The in-memory result of a local library scan.

use crate::modules::local_library::domain::local_game::{LocalGame, SteamAppId};

/// A diagnostic recorded while scanning manifests.
///
/// A manifest that is malformed, inconsistent, or unreadable is skipped and
/// reported here; it never aborts the rest of the scan. Diagnostics carry
/// only the manifest file name, never an absolute path.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ScanDiagnostic {
    /// The manifest file name the diagnostic concerns.
    pub manifest: String,
    /// A short human-readable reason.
    pub message: String,
}

/// An immutable snapshot of the locally installed games.
///
/// The snapshot is held in memory and contains no absolute path; games are
/// keyed by provider AppID so the frontend can join them with the remote
/// library.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LocalLibrarySnapshot {
    games: Vec<LocalGame>,
    diagnostics: Vec<ScanDiagnostic>,
}

impl LocalLibrarySnapshot {
    /// Builds a snapshot from the scanned games and their diagnostics.
    pub fn new(games: Vec<LocalGame>, diagnostics: Vec<ScanDiagnostic>) -> Self {
        Self { games, diagnostics }
    }

    /// Every game found in the declared libraries.
    pub fn games(&self) -> &[LocalGame] {
        &self.games
    }

    /// Finds the game with the given AppID, when present.
    pub fn find(&self, app_id: SteamAppId) -> Option<&LocalGame> {
        self.games
            .iter()
            .find(|game| game.external_game_id() == app_id)
    }

    /// Diagnostics recorded for skipped or inconsistent manifests.
    pub fn diagnostics(&self) -> &[ScanDiagnostic] {
        &self.diagnostics
    }
}
