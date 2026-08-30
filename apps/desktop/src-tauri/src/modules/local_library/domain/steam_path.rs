//! Domain types for discovering Steam installations on Windows.
//!
//! The Windows Registry is reached only through the [`SteamRegistry`] port;
//! the locator and all tests use fakes. Local absolute paths stay inside
//! the Rust runtime — no type in this module is serialized, and no path
//! ever crosses the Tauri API.

use std::path::{Path, PathBuf};

/// A Steam library root found on this machine.
///
/// The root path is stored internally; the scanner-facing surface is the
/// validated [`Self::steamapps`] directory. [`Self::root`] is available to
/// the locator and tests, but `SteamLibrary` derives no serialization, so
/// local paths never leave the Rust process.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SteamLibrary {
    root: PathBuf,
    steamapps: PathBuf,
}

impl SteamLibrary {
    /// Builds a library from a root whose `steamapps` directory has been
    /// validated to exist.
    pub(crate) fn new(root: PathBuf) -> Self {
        let steamapps = root.join("steamapps");
        Self { root, steamapps }
    }

    /// The library root directory.
    ///
    /// Crate-internal: the locator and tests use it, but scanners consume
    /// [`Self::steamapps`] instead, so local paths never leave the crate.
    pub(crate) fn root(&self) -> &Path {
        &self.root
    }

    /// The validated `steamapps` directory of this library.
    pub fn steamapps(&self) -> PathBuf {
        self.steamapps.clone()
    }
}

/// Errors raised while discovering Steam libraries on this machine.
///
/// Later tasks extend this enum with the remaining operational states from
/// the design (manifest-invalid, permission-denied, ...).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum DiscoveryError {
    /// No Steam installation or declared library could be found.
    SteamNotFound,
}

impl std::fmt::Display for DiscoveryError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            DiscoveryError::SteamNotFound => {
                write!(f, "steam is not installed or no library could be found")
            }
        }
    }
}

impl std::error::Error for DiscoveryError {}

/// Port for discovering candidate Steam installation roots.
///
/// The concrete Windows implementation reads the Valve Registry keys; tests
/// provide fakes so discovery never touches the host Registry.
pub trait SteamRegistry {
    /// Returns the candidate Steam install directories reported by the
    /// platform, deduplicated, ignoring missing keys.
    fn candidate_install_paths(&self) -> Result<Vec<PathBuf>, DiscoveryError>;
}

/// Normalizes a path into a deduplication key: separators become `/`,
/// trailing separators are stripped, and on Windows (where paths are
/// case-insensitive) the key is lowercased.
///
/// Deduplication is deliberately by normalized path *string*, not
/// filesystem identity: `fs::canonicalize` would resolve symlinks and
/// return `\\?\`-prefixed paths on Windows, which would break key equality
/// between the Registry value and the VDF `path` entries.
pub(crate) fn dedupe_key(path: &Path) -> String {
    let mut key = path.to_string_lossy().replace('\\', "/");
    while key.ends_with('/') {
        key.pop();
    }
    #[cfg(windows)]
    {
        key.make_ascii_lowercase();
    }
    key
}
