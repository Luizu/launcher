//! Tauri commands for game actions: launch, install requests, and
//! install-state refresh.
//!
//! The commands are thin adapters: the frontend sends an integer AppID
//! (`u32`), which is parsed into a validated [`SteamAppId`] before any URI
//! is built. Arbitrary strings from API responses can never reach the
//! opener — the only strings that ever do are the `steam://` URIs built by
//! [`SteamUri`].

use crate::commands::CommandError;
use crate::modules::game_actions::application::game_action_service::ProtocolOpener;
use crate::modules::game_actions::domain::install_status::{
    ActionAccepted, GameActionError, InstallStatus,
};
use crate::modules::local_library::application::scan_local_library::LibraryDiscovery;
use crate::modules::local_library::domain::local_game::{Provider, SteamAppId};
use crate::{NativeRuntimeState, RuntimeState};
use serde::Serialize;
use std::time::SystemTime;

/// Result of an accepted launch or install request.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ActionAcceptedDto {
    /// Whether the action was dispatched to the Steam client.
    pub accepted: bool,
}

impl From<ActionAccepted> for ActionAcceptedDto {
    fn from(_: ActionAccepted) -> Self {
        Self { accepted: true }
    }
}

/// Install state reported to the frontend.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallStatusDto {
    /// The observed installation state of the game.
    pub state: InstallStatusStateDto,
}

/// The serialized installation state.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum InstallStatusStateDto {
    /// The game is fully installed.
    Installed,
    /// The installation is in progress.
    Installing,
    /// The state cannot be verified.
    Unknown,
}

impl From<InstallStatus> for InstallStatusDto {
    fn from(status: InstallStatus) -> Self {
        let state = match status {
            InstallStatus::Installed => InstallStatusStateDto::Installed,
            InstallStatus::Installing => InstallStatusStateDto::Installing,
            InstallStatus::Unknown => InstallStatusStateDto::Unknown,
        };
        Self { state }
    }
}

impl From<GameActionError> for CommandError {
    fn from(error: GameActionError) -> Self {
        match error {
            GameActionError::GameNotInstalled => CommandError::new(
                "game-not-installed",
                "the game is not in the local installed snapshot",
            ),
            GameActionError::InvalidAppId => CommandError::new(
                "invalid-app-id",
                "the steam app id must be a positive number",
            ),
            GameActionError::OpenFailed { detail } => CommandError::new(
                "open-failed",
                format!("could not open the steam url: {detail}"),
            ),
        }
    }
}

/// Requests the Steam client to launch a game installed in the local
/// snapshot.
///
/// Refuses with `game-not-installed` when the game is absent from the
/// snapshot or not fully installed; opens `steam://rungameid/<app_id>` only
/// through the opener plugin.
#[tauri::command]
pub fn game_actions_launch(
    state: tauri::State<'_, NativeRuntimeState>,
    app_id: u32,
) -> Result<ActionAcceptedDto, CommandError> {
    game_actions_launch_inner(&state, app_id)
}

/// Requests the Steam client to install a game.
///
/// Records `install-requested` in the in-memory tracker and opens
/// `steam://install/<app_id>`.
#[tauri::command]
pub fn game_actions_install(
    state: tauri::State<'_, NativeRuntimeState>,
    app_id: u32,
) -> Result<ActionAcceptedDto, CommandError> {
    game_actions_install_inner(&state, app_id)
}

/// Reports the local install state of a game from its manifest.
///
/// The read is bounded to the requested game's own manifest and runs off
/// the UI thread, so polling while `Installing` never blocks the UI.
#[tauri::command]
pub async fn game_actions_get_install_status(
    state: tauri::State<'_, NativeRuntimeState>,
    app_id: u32,
) -> Result<InstallStatusDto, CommandError> {
    game_actions_get_install_status_inner(&state, app_id).await
}

/// The launch command logic, generic over the composition ports so the
/// command layer can be invoked directly in tests over fakes — and, through
/// the test-only [`smoke`] seam, by the integration smoke harness. See
/// [`game_actions_launch`].
///
/// [`smoke`]: crate::smoke
pub fn game_actions_launch_inner<L: LibraryDiscovery, O: ProtocolOpener>(
    state: &RuntimeState<L, O>,
    app_id: u32,
) -> Result<ActionAcceptedDto, CommandError> {
    let app_id = match parse_app_id(app_id) {
        Ok(app_id) => app_id,
        Err(error) => {
            log::warn!("launch refused for app id {app_id}: {}", error.message);
            return Err(error);
        }
    };
    state
        .actions
        .launch(app_id)
        .map(|accepted| {
            log::info!("launch: opened steam uri for app id {}", app_id.as_u32());
            // The history is local by design and best-effort by contract: a
            // persistence failure is logged and never fails the launch, and
            // the record is never included in any API request.
            if let Err(error) = state
                .history
                .record(Provider::Steam, app_id.as_u32(), SystemTime::now())
            {
                log::warn!(
                    "launch: could not record the launch of app id {} in the local history: {error}",
                    app_id.as_u32()
                );
            }
            ActionAcceptedDto::from(accepted)
        })
        .map_err(|error| {
            log::warn!(
                "launch not accepted for app id {}: {error}",
                app_id.as_u32()
            );
            CommandError::from(error)
        })
}

/// The install command logic; see [`game_actions_install`].
pub fn game_actions_install_inner<L: LibraryDiscovery, O: ProtocolOpener>(
    state: &RuntimeState<L, O>,
    app_id: u32,
) -> Result<ActionAcceptedDto, CommandError> {
    let app_id = match parse_app_id(app_id) {
        Ok(app_id) => app_id,
        Err(error) => {
            log::warn!("install refused for app id {app_id}: {}", error.message);
            return Err(error);
        }
    };
    state
        .actions
        .install(app_id)
        .map(|accepted| {
            log::info!("install: opened steam uri for app id {}", app_id.as_u32());
            ActionAcceptedDto::from(accepted)
        })
        .map_err(|error| {
            log::warn!(
                "install not accepted for app id {}: {error}",
                app_id.as_u32()
            );
            CommandError::from(error)
        })
}

/// The install-status command logic; see [`game_actions_get_install_status`].
pub async fn game_actions_get_install_status_inner<
    L: LibraryDiscovery + Clone + Send + 'static,
    O: ProtocolOpener,
>(
    state: &RuntimeState<L, O>,
    app_id: u32,
) -> Result<InstallStatusDto, CommandError> {
    let app_id = parse_app_id(app_id)?;
    let service = state.install_status.clone();
    let status = tauri::async_runtime::spawn_blocking(move || service.get(app_id))
        .await
        .map_err(|_| {
            CommandError::new("status-refresh-failed", "the status refresh was cancelled")
        })?
        .map_err(CommandError::from)?;
    Ok(InstallStatusDto::from(status))
}

/// Parses the frontend's integer AppID into a validated [`SteamAppId`].
///
/// This is the only place API-provided identifiers become game actions; a
/// non-positive value is rejected before any URI is built.
fn parse_app_id(app_id: u32) -> Result<SteamAppId, CommandError> {
    SteamAppId::new(app_id).map_err(|_| CommandError::from(GameActionError::InvalidAppId))
}
