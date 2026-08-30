//! Thin IPC adapters: Tauri commands over the local-library and
//! game-actions modules.

pub mod diagnostics;
pub mod game_actions;
pub mod launch_history;
pub mod local_library;

use serde::Serialize;

/// Typed error payload returned by every native command.
///
/// Serialized as `{ "code": "...", "message": "..." }`; the frontend
/// branches on the stable `code` values from the design's operational error
/// list and shows the message as the next possible action.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandError {
    /// A stable machine-readable error code.
    pub code: String,
    /// A short human-readable message.
    pub message: String,
}

impl CommandError {
    /// Builds a command error with the given stable code and message.
    pub fn new(code: &'static str, message: impl Into<String>) -> Self {
        Self {
            code: code.to_string(),
            message: message.into(),
        }
    }
}
