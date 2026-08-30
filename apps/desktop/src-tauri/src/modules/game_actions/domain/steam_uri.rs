//! Safe construction of `steam://` protocol URIs.
//!
//! A [`SteamUri`] can only be created through the [`launch`], [`install`] and
//! [`open_downloads`] constructors; there is no arbitrary-string constructor,
//! so values coming from API responses can never be spliced into a protocol
//! URI. The URI is always built inside Rust from a validated [`SteamAppId`]
//! and opened through the opener adapter — never through a shell.

use crate::modules::local_library::domain::local_game::SteamAppId;

/// A validated Steam protocol URI.
///
/// Stores the final URI string; the only reader is [`Self::as_str`].
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SteamUri(String);

impl SteamUri {
    /// `steam://rungameid/<app_id>` — asks the Steam client to run the game.
    pub fn launch(app_id: SteamAppId) -> Self {
        Self(format!("steam://rungameid/{}", app_id.as_u32()))
    }

    /// `steam://install/<app_id>` — asks the Steam client to install the game.
    pub fn install(app_id: SteamAppId) -> Self {
        Self(format!("steam://install/{}", app_id.as_u32()))
    }

    /// `steam://open/downloads` — asks the Steam client to show its downloads.
    ///
    /// The frontend opens this through the opener plugin's JS binding (the
    /// capability grants the `steam:*` scheme); the constructor exists so
    /// the URI is built and tested inside Rust, never by string template.
    #[allow(dead_code)] // opened by the frontend via plugin:opener|open_url; no Rust command calls it in this task
    pub fn open_downloads() -> Self {
        Self("steam://open/downloads".to_string())
    }

    /// The final URI string.
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

#[cfg(test)]
mod tests {
    use super::SteamUri;
    use crate::modules::local_library::domain::local_game::SteamAppId;

    #[test]
    fn builds_only_the_supported_launch_and_install_uris() {
        let app_id = SteamAppId::new(730).unwrap();

        assert_eq!(SteamUri::launch(app_id).as_str(), "steam://rungameid/730");
        assert_eq!(SteamUri::install(app_id).as_str(), "steam://install/730");
    }

    #[test]
    fn builds_an_open_downloads_uri() {
        assert_eq!(
            SteamUri::open_downloads().as_str(),
            "steam://open/downloads"
        );
    }

    #[test]
    fn the_uri_embeds_the_app_id_number_and_not_the_type_name() {
        assert_eq!(
            SteamUri::launch(SteamAppId::new(570).unwrap()).as_str(),
            "steam://rungameid/570"
        );
    }
}
