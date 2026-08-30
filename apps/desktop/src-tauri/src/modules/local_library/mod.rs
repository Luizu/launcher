pub mod application;
pub mod domain;
pub mod infrastructure;

pub use domain::local_game::{LocalGame, LocalInstallState, Provider, SteamAppId};
pub use domain::local_library_snapshot::{LocalLibrarySnapshot, ScanDiagnostic};
pub use domain::steam_path::{DiscoveryError, SteamLibrary, SteamRegistry};
pub use infrastructure::app_manifest_reader::AppManifestReader;
pub use infrastructure::steam_library_locator::SteamLibraryLocator;
pub use infrastructure::windows::steam_registry::WindowsSteamRegistry;
