//! Tauri opener adapter for `steam://` protocol URIs.
//!
//! The adapter hands only validated [`SteamUri`] values to the official
//! `tauri-plugin-opener` — never arbitrary strings, never a shell. The
//! window capability additionally restricts the plugin's JS surface to the
//! `steam:*` scheme, `steamcommunity.com`, and `api.steampowered.com`;
//! shell execution and unrestricted path opening are not enabled anywhere.

use crate::modules::game_actions::application::game_action_service::ProtocolOpener;
use crate::modules::game_actions::domain::install_status::GameActionError;
use crate::modules::game_actions::domain::steam_uri::SteamUri;

/// Opens `steam://` URIs through the Tauri app handle and the opener plugin.
#[derive(Debug, Clone)]
pub struct SteamProtocolOpener {
    app: tauri::AppHandle,
}

impl SteamProtocolOpener {
    /// Creates the adapter for the given application handle.
    ///
    /// The composition root passes the handle of the running Tauri app; the
    /// adapter stays behind the [`ProtocolOpener`] trait so action tests use
    /// a fake and never touch the platform opener.
    pub fn new(app: tauri::AppHandle) -> Self {
        Self { app }
    }
}

impl ProtocolOpener for SteamProtocolOpener {
    fn open(&self, uri: &SteamUri) -> Result<(), GameActionError> {
        use tauri_plugin_opener::OpenerExt;

        // The opener plugin opens the URI with the platform's default
        // handler for the `steam://` scheme — no shell is involved.
        self.app
            .opener()
            .open_url(uri.as_str(), None::<&str>)
            .map_err(|error| GameActionError::OpenFailed {
                detail: error.to_string(),
            })
    }
}
