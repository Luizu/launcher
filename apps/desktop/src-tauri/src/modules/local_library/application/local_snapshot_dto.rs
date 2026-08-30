//! Frontend-facing serialization DTOs for the local library snapshot.
//!
//! The domain snapshot deliberately derives no serialization, so local
//! absolute paths can never cross the Tauri API. This module is the only
//! serializable projection of a scan result, and it carries no path of any
//! kind: games are identified by provider and numeric AppID only.

use crate::modules::local_library::domain::local_game::{LocalGame, LocalInstallState, Provider};
use crate::modules::local_library::domain::local_library_snapshot::{
    LocalLibrarySnapshot, ScanDiagnostic,
};
use serde::{Deserialize, Serialize};

/// The scan result sent to the frontend: games plus skipped-manifest
/// diagnostics.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalSnapshotDto {
    /// The normalized local games of the snapshot.
    pub games: Vec<LocalGameDto>,
    /// Diagnostics for manifests that were skipped or inconsistent.
    pub diagnostics: Vec<ScanDiagnosticDto>,
}

/// One normalized local game; contains no path.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalGameDto {
    /// The external provider of the game (`steam` in the MVP).
    pub provider: ProviderDto,
    /// The numeric provider-side identifier of the game.
    pub external_game_id: u32,
    /// The normalized display name.
    pub name: String,
    /// The observed local installation state.
    pub state: LocalInstallStateDto,
}

/// The serialized external provider.
///
/// `Deserialize` exists so the launch-history store can persist the provider
/// identity in the same canonical wire vocabulary the frontend sees; the
/// store is the only deserialization consumer of this projection.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ProviderDto {
    /// Steam is the only provider in the MVP.
    Steam,
}

impl From<Provider> for ProviderDto {
    fn from(provider: Provider) -> Self {
        match provider {
            Provider::Steam => ProviderDto::Steam,
        }
    }
}

impl From<ProviderDto> for Provider {
    fn from(provider: ProviderDto) -> Self {
        match provider {
            ProviderDto::Steam => Provider::Steam,
        }
    }
}

/// The serialized local installation state.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum LocalInstallStateDto {
    /// The game is fully installed.
    Installed,
    /// A manifest exists but the installation is incomplete.
    Installing,
    /// The manifest could not be verified.
    Unknown,
}

/// A serialized scan diagnostic; carries only the manifest file name.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanDiagnosticDto {
    /// The manifest file name the diagnostic concerns.
    pub manifest: String,
    /// A short human-readable reason.
    pub message: String,
}

impl From<&LocalLibrarySnapshot> for LocalSnapshotDto {
    fn from(snapshot: &LocalLibrarySnapshot) -> Self {
        Self {
            games: snapshot.games().iter().map(LocalGameDto::from).collect(),
            diagnostics: snapshot
                .diagnostics()
                .iter()
                .map(ScanDiagnosticDto::from)
                .collect(),
        }
    }
}

impl From<&LocalGame> for LocalGameDto {
    fn from(game: &LocalGame) -> Self {
        let provider = match game.provider() {
            Provider::Steam => ProviderDto::Steam,
        };
        let state = match game.state() {
            LocalInstallState::Installed => LocalInstallStateDto::Installed,
            LocalInstallState::Installing => LocalInstallStateDto::Installing,
            LocalInstallState::Unknown => LocalInstallStateDto::Unknown,
        };
        Self {
            provider,
            external_game_id: game.external_game_id().as_u32(),
            name: game.name().to_string(),
            state,
        }
    }
}

impl From<&ScanDiagnostic> for ScanDiagnosticDto {
    fn from(diagnostic: &ScanDiagnostic) -> Self {
        Self {
            manifest: diagnostic.manifest.clone(),
            message: diagnostic.message.clone(),
        }
    }
}
