//! Tauri command for scanning the local Steam library.

use crate::commands::CommandError;
use crate::modules::game_actions::application::game_action_service::ProtocolOpener;
use crate::modules::local_library::application::local_snapshot_dto::LocalSnapshotDto;
use crate::modules::local_library::application::scan_local_library::LibraryDiscovery;
use crate::{NativeRuntimeState, RuntimeState};

/// Scans the declared Steam libraries for installed-game manifests.
///
/// The scan runs on the Tauri async runtime (`spawn_blocking`) so the UI
/// thread never blocks on filesystem I/O. The result becomes the current
/// snapshot for game actions and is returned as a path-free DTO.
///
/// Stale-until-success: on failure the previous snapshot is retained and
/// game actions keep authorizing from the last successful scan. The blast
/// radius is bounded — the opener capability only ever grants the `steam:`
/// scheme and the two Steam hosts — but the retry path should always
/// rescan before trusting the old snapshot. The error match below folds
/// every [`DiscoveryError`] into `steam-not-installed` today; as that enum
/// grows variants, this match must grow with it so each failure keeps its
/// own stable error code.
///
/// [`DiscoveryError`]: crate::modules::local_library::domain::steam_path::DiscoveryError
#[tauri::command]
pub async fn local_library_scan(
    state: tauri::State<'_, NativeRuntimeState>,
) -> Result<LocalSnapshotDto, CommandError> {
    local_library_scan_inner(&state).await
}

/// The scan command logic, generic over the composition ports so the
/// command layer can be invoked directly in tests over fakes — and, through
/// the test-only [`smoke`] seam, by the integration smoke harness. See
/// [`local_library_scan`] for the stale-until-success semantics.
///
/// [`smoke`]: crate::smoke
pub async fn local_library_scan_inner<
    L: LibraryDiscovery + Clone + Send + 'static,
    O: ProtocolOpener,
>(
    state: &RuntimeState<L, O>,
) -> Result<LocalSnapshotDto, CommandError> {
    let scanner = state.scanner.clone();
    let scanned = tauri::async_runtime::spawn_blocking(move || scanner.execute()).await;
    let snapshot = match scanned {
        Ok(Ok(snapshot)) => snapshot,
        Ok(Err(_)) => {
            return Err(CommandError::new(
                "steam-not-installed",
                "steam is not installed or no library could be found",
            ));
        }
        Err(_) => {
            return Err(CommandError::new(
                "scan-failed",
                "the library scan was cancelled",
            ));
        }
    };

    *state.snapshot.lock().expect("snapshot mutex poisoned") = snapshot.clone();
    Ok(LocalSnapshotDto::from(&snapshot))
}
