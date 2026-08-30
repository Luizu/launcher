//! Domain model of a game known to the local library.

use std::fmt;

/// A validated Steam application identifier.
///
/// Steam AppIDs are positive integers; zero is not a valid identifier. The
/// frontend only ever receives the numeric value, never a path.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct SteamAppId(u32);

/// Errors from [`SteamAppId::new`].
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SteamAppIdError {
    /// Steam AppIDs are positive; `0` is rejected.
    ZeroNotAllowed,
}

impl fmt::Display for SteamAppIdError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            SteamAppIdError::ZeroNotAllowed => {
                write!(f, "steam appid must be a positive number")
            }
        }
    }
}

impl std::error::Error for SteamAppIdError {}

impl SteamAppId {
    /// Accepts only positive `u32` values.
    pub fn new(value: u32) -> Result<Self, SteamAppIdError> {
        if value == 0 {
            Err(SteamAppIdError::ZeroNotAllowed)
        } else {
            Ok(Self(value))
        }
    }

    /// The numeric value of this AppID.
    ///
    /// This is the only way the identifier leaves the crate: the frontend
    /// receives the number (never a path), and URI construction embeds the
    /// number into the validated `steam://` scheme.
    pub fn as_u32(&self) -> u32 {
        self.0
    }
}

/// The external provider a local game belongs to.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Provider {
    /// Steam is the only provider in the MVP.
    Steam,
}

/// The observed installation state of a locally known game.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LocalInstallState {
    /// The manifest reports a complete install and the install directory
    /// exists on disk.
    Installed,
    /// A manifest exists but the reported state or the install directory is
    /// incomplete.
    Installing,
    /// The manifest could not be parsed, or its data is inconsistent.
    Unknown,
}

/// A normalized game entry from the local library.
///
/// Contains no local paths; paths stay inside the manifest reader and the
/// action service, so this type is safe for the frontend-facing snapshot.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LocalGame {
    provider: Provider,
    external_game_id: SteamAppId,
    name: String,
    state: LocalInstallState,
}

impl LocalGame {
    /// Builds a normalized local game entry.
    pub fn new(
        provider: Provider,
        external_game_id: SteamAppId,
        name: String,
        state: LocalInstallState,
    ) -> Self {
        Self {
            provider,
            external_game_id,
            name,
            state,
        }
    }

    /// The provider this game belongs to.
    pub fn provider(&self) -> Provider {
        self.provider
    }

    /// The provider-side identifier of this game.
    pub fn external_game_id(&self) -> SteamAppId {
        self.external_game_id
    }

    /// The normalized display name of this game.
    pub fn name(&self) -> &str {
        &self.name
    }

    /// The observed local installation state.
    pub fn state(&self) -> LocalInstallState {
        self.state
    }
}
