//! Windows Registry adapter for Steam install locations.
//!
//! Registry access lives exclusively in this module. On non-Windows
//! targets the type still exists (a stub returning [`SteamNotFound`]), so
//! the crate compiles and tests run on any host; tests never touch the
//! host Registry because they drive the [`SteamRegistry`] port with fakes.
//!
//! [`SteamNotFound`]: crate::modules::local_library::domain::steam_path::DiscoveryError::SteamNotFound

#[cfg(windows)]
use crate::modules::local_library::domain::steam_path::dedupe_key;
use crate::modules::local_library::domain::steam_path::{DiscoveryError, SteamRegistry};
use std::path::PathBuf;

/// Reads the Valve Steam keys of the Windows Registry.
///
/// Constructed by the composition root on every host; the non-Windows stub
/// keeps the crate building and returning `SteamNotFound` there, and tests
/// never touch the host Registry because they drive the [`SteamRegistry`]
/// port with fakes.
#[derive(Debug, Clone)]
pub struct WindowsSteamRegistry;

#[cfg(windows)]
impl SteamRegistry for WindowsSteamRegistry {
    fn candidate_install_paths(&self) -> Result<Vec<PathBuf>, DiscoveryError> {
        // winreg 0.56 exports the `HKEY_*` constants from `enums` but the
        // `HKEY` type itself only from the crate root.
        use winreg::enums::{HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE};
        use winreg::{RegKey, HKEY};

        const VALUE_NAMES: [&str; 2] = ["SteamPath", "InstallPath"];
        const REGISTRY_LOCATIONS: [(HKEY, &str); 3] = [
            (HKEY_CURRENT_USER, "Software\\Valve\\Steam"),
            (HKEY_LOCAL_MACHINE, "Software\\Valve\\Steam"),
            (HKEY_LOCAL_MACHINE, "Software\\WOW6432Node\\Valve\\Steam"),
        ];

        let mut paths = Vec::new();
        let mut seen = std::collections::HashSet::new();
        for (hkey, subkey) in REGISTRY_LOCATIONS {
            let Ok(key) = RegKey::predef(hkey).open_subkey(subkey) else {
                continue; // missing key: ignore and keep going
            };
            for name in VALUE_NAMES {
                if let Ok(value) = key.get_value::<String, _>(name) {
                    let path = PathBuf::from(value);
                    if seen.insert(dedupe_key(&path)) {
                        paths.push(path);
                    }
                }
            }
        }
        Ok(paths)
    }
}

#[cfg(not(windows))]
impl SteamRegistry for WindowsSteamRegistry {
    fn candidate_install_paths(&self) -> Result<Vec<PathBuf>, DiscoveryError> {
        Err(DiscoveryError::SteamNotFound)
    }
}
