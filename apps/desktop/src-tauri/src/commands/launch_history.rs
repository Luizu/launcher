//! Tauri command serving the desktop-local launch history.

use crate::modules::game_actions::application::game_action_service::ProtocolOpener;
use crate::modules::launch_history::LaunchHistoryDto;
use crate::modules::local_library::application::scan_local_library::LibraryDiscovery;
use crate::{NativeRuntimeState, RuntimeState};

/// Returns the local launch history: the last launch instant per provider
/// entry.
///
/// The history is desktop-local by design and is never included in any API
/// request: it only exists to break ties in the Home featured-game pick
/// when the provider reports no activity. A store that failed to persist
/// still serves the in-memory records of this session.
#[tauri::command]
pub fn launch_history_get(state: tauri::State<'_, NativeRuntimeState>) -> LaunchHistoryDto {
    launch_history_get_inner(&state)
}

/// The launch-history command logic, generic over the composition ports so
/// the command layer can be invoked directly in tests over fakes — and,
/// through the test-only [`smoke`] seam, by the integration smoke harness.
/// See [`launch_history_get`].
///
/// [`smoke`]: crate::smoke
pub fn launch_history_get_inner<L: LibraryDiscovery, O: ProtocolOpener>(
    state: &RuntimeState<L, O>,
) -> LaunchHistoryDto {
    state.history.entries()
}
