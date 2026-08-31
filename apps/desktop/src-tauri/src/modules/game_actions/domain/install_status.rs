//! Domain types for the observable installation state of a local game.
//!
//! Fuse Launcher tracks installation state, but never claims an exact
//! download percentage; the states below are derived only from the game's
//! manifest and install directory.

use std::fmt;

/// The observable installation state of a game.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum InstallStatus {
    /// The manifest reports a complete install and the install directory
    /// exists on disk.
    Installed,
    /// A manifest exists but the installation is incomplete.
    Installing,
    /// The Steam path, the manifest, or the reported state cannot be
    /// verified.
    Unknown,
}

/// Marker that a game action was accepted and dispatched to the Steam
/// client.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ActionAccepted;

/// Errors raised by game actions and install-state queries.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum GameActionError {
    /// The game is not present as `Installed` in the current local snapshot.
    GameNotInstalled,
    /// The AppID is not a positive integer, so no URI may be built for it.
    InvalidAppId,
    /// The validated `steam://` URI could not be handed to the platform
    /// opener.
    OpenFailed {
        /// A short description of the opener failure.
        detail: String,
    },
}

impl fmt::Display for GameActionError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            GameActionError::GameNotInstalled => {
                write!(f, "the game is not installed in the local snapshot")
            }
            GameActionError::InvalidAppId => {
                write!(f, "the steam app id must be a positive number")
            }
            GameActionError::OpenFailed { detail } => {
                write!(f, "could not open the steam url: {detail}")
            }
        }
    }
}

impl std::error::Error for GameActionError {}
