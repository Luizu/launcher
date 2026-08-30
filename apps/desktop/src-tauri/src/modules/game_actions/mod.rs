//! Game actions: launch, install requests, and install-state refresh.
//!
//! The module is layered like `local-library`: the domain builds validated
//! `steam://` URIs and models install state, the application services check
//! the snapshot and record install requests through small ports, and the
//! infrastructure adapter opens URIs through the official Tauri opener
//! plugin. The composition root in `lib.rs` wires the concrete adapters.

pub mod application;
pub mod domain;
pub mod infrastructure;

pub use application::game_action_service::{GameActionService, SnapshotProvider};
pub use application::install_status_service::InstallStatusService;
pub use infrastructure::steam_protocol_opener::SteamProtocolOpener;
