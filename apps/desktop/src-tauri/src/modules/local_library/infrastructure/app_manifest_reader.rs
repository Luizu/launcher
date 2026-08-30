//! Reads `appmanifest_<appid>.acf` files from a Steam library's `steamapps`
//! directory.
//!
//! Only filenames matching `appmanifest_<positive-number>.acf` are read.
//! A malformed manifest is skipped and reported as a diagnostic; it never
//! aborts the scan of the other manifests. Local paths are constructed and
//! checked here and never leave this module.

use crate::modules::local_library::infrastructure::valve_kv::ValveKeyValueParser;
use crate::modules::local_library::{
    LocalGame, LocalInstallState, Provider, ScanDiagnostic, SteamAppId,
};
use std::ffi::OsStr;
use std::path::Path;

/// The `StateFlags` value Steam writes for a fully installed game.
const INSTALLED_STATE_FLAGS: u32 = 4;

/// The outcome of reading one entry of a library's `steamapps` directory.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ManifestRead {
    /// The file name is not an `appmanifest_<appid>.acf` file; the scanner
    /// ignores it without a diagnostic.
    Skipped,
    /// A valid game manifest was parsed. `diagnostic` is `Some` when the
    /// game was kept with an [`Unknown`] state because its state data is
    /// inconsistent.
    ///
    /// [`Unknown`]: LocalInstallState::Unknown
    Game {
        game: LocalGame,
        diagnostic: Option<ScanDiagnostic>,
    },
    /// A malformed manifest that is skipped; the diagnostic explains why and
    /// the scan continues.
    Invalid(ScanDiagnostic),
}

/// Reads a single app manifest from a library's `steamapps` directory.
#[derive(Debug, Clone)]
pub struct AppManifestReader;

impl AppManifestReader {
    /// Reads `file_name` inside `steamapps`.
    ///
    /// Returns [`ManifestRead::Skipped`] when the file name does not match
    /// `appmanifest_<positive-number>.acf`, [`ManifestRead::Game`] when the
    /// manifest is valid, and [`ManifestRead::Invalid`] with a diagnostic
    /// when the manifest is malformed or its data is inconsistent.
    pub fn read(&self, steamapps: &Path, file_name: &OsStr) -> ManifestRead {
        let Some(file_app_id) = manifest_app_id(file_name) else {
            return ManifestRead::Skipped;
        };
        let manifest_name = file_name.to_string_lossy().into_owned();

        let text = match std::fs::read_to_string(steamapps.join(file_name)) {
            Ok(text) => text,
            Err(_) => {
                return ManifestRead::Invalid(diagnostic(
                    &manifest_name,
                    "manifest could not be read",
                ));
            }
        };
        let value = match ValveKeyValueParser::parse(&text) {
            Ok(value) => value,
            Err(_) => {
                return ManifestRead::Invalid(diagnostic(
                    &manifest_name,
                    "manifest is not valid valve keyvalues",
                ));
            }
        };

        let Some(app_state) = value.object("AppState") else {
            return ManifestRead::Invalid(diagnostic(&manifest_name, "AppState object is missing"));
        };
        let Some(app_id_text) = app_state.string("appid") else {
            return ManifestRead::Invalid(diagnostic(&manifest_name, "appid is missing"));
        };
        let Ok(parsed_app_id) = app_id_text.parse::<u32>() else {
            return ManifestRead::Invalid(diagnostic(&manifest_name, "appid is not a number"));
        };
        let Ok(app_id) = SteamAppId::new(parsed_app_id) else {
            return ManifestRead::Invalid(diagnostic(&manifest_name, "appid is not positive"));
        };
        if parsed_app_id != file_app_id {
            return ManifestRead::Invalid(diagnostic(
                &manifest_name,
                "appid does not match the manifest file name",
            ));
        }
        let Some(name) = app_state.string("name") else {
            return ManifestRead::Invalid(diagnostic(&manifest_name, "name is missing"));
        };
        let name = normalize_name(name);
        if name.is_empty() {
            return ManifestRead::Invalid(diagnostic(&manifest_name, "name is empty"));
        }
        let Some(install_dir_name) = app_state.string("installdir") else {
            return ManifestRead::Invalid(diagnostic(&manifest_name, "installdir is missing"));
        };
        // An empty installdir would resolve to `steamapps/common` itself and
        // `"."`/`".."` to `steamapps/common` or `steamapps`; with `StateFlags
        // == 4` and any installed game present, that would report a false
        // `Installed`, so such values are rejected like path escapes.
        if install_dir_name.is_empty()
            || install_dir_name == "."
            || install_dir_name == ".."
            || install_dir_name.contains('/')
            || install_dir_name.contains('\\')
        {
            return ManifestRead::Invalid(diagnostic(
                &manifest_name,
                "installdir is not a plain directory name",
            ));
        }

        let install_dir = steamapps.join("common").join(install_dir_name);
        let (state, state_diagnostic) = derive_state(app_state.string("StateFlags"), &install_dir);

        let game = LocalGame::new(Provider::Steam, app_id, name, state);
        ManifestRead::Game {
            game,
            diagnostic: state_diagnostic.map(|reason| {
                let mut diagnostic = diagnostic(&manifest_name, reason);
                diagnostic
                    .message
                    .push_str("; treating the game state as unknown");
                diagnostic
            }),
        }
    }
}

/// Extracts the AppID from an `appmanifest_<positive-number>.acf` file name.
fn manifest_app_id(file_name: &OsStr) -> Option<u32> {
    let name = file_name.to_str()?;
    let digits = name.strip_prefix("appmanifest_")?.strip_suffix(".acf")?;
    if digits.is_empty() || !digits.bytes().all(|byte| byte.is_ascii_digit()) {
        return None;
    }
    let app_id = digits.parse::<u32>().ok()?;
    (app_id > 0).then_some(app_id)
}

/// Normalizes a manifest name: trims surrounding whitespace.
fn normalize_name(name: &str) -> String {
    name.trim().to_string()
}

/// Derives the install state from the manifest's `StateFlags` and the
/// existence of the expected install directory.
///
/// `StateFlags == 4` with an existing install directory is `Installed`;
/// any manifest whose state or directory is incomplete is `Installing`.
/// A missing or non-numeric `StateFlags` is inconsistent data and yields
/// `Unknown` with a diagnostic reason.
fn derive_state(
    state_flags: Option<&str>,
    install_dir: &Path,
) -> (LocalInstallState, Option<&'static str>) {
    match state_flags.and_then(|flags| flags.parse::<u32>().ok()) {
        Some(flags) if flags == INSTALLED_STATE_FLAGS && install_dir.is_dir() => {
            (LocalInstallState::Installed, None)
        }
        Some(_) => (LocalInstallState::Installing, None),
        None => (
            LocalInstallState::Unknown,
            Some("state flags are missing or not a number"),
        ),
    }
}

/// Builds a diagnostic for `manifest_name`.
fn diagnostic(manifest_name: &str, message: &str) -> ScanDiagnostic {
    ScanDiagnostic {
        manifest: manifest_name.to_string(),
        message: message.to_string(),
    }
}
