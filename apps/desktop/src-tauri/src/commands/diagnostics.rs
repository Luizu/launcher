//! Safe, local diagnostics commands exposed to the desktop shell.

use crate::commands::CommandError;
use std::path::Path;
use tauri::{AppHandle, Manager};
use tauri_plugin_opener::OpenerExt;

/// Reveals the Tauri-managed application log directory in the system file
/// explorer. The frontend cannot provide a path, which keeps this command
/// from becoming an arbitrary path opener.
#[tauri::command]
pub fn diagnostics_open_logs(app: AppHandle) -> Result<(), CommandError> {
    let log_directory = app.path().app_log_dir().map_err(|_| {
        CommandError::new(
            "log-directory-unavailable",
            "the application log directory is unavailable",
        )
    })?;

    ensure_log_directory(&log_directory).map_err(|_| {
        CommandError::new(
            "log-directory-unavailable",
            "the application log directory could not be prepared",
        )
    })?;

    app.opener()
        .reveal_item_in_dir(&log_directory)
        .map_err(|_| {
            CommandError::new(
                "log-directory-open-failed",
                "the application log directory could not be opened",
            )
        })
}

pub(crate) fn ensure_log_directory(path: &Path) -> std::io::Result<()> {
    std::fs::create_dir_all(path)
}

#[cfg(test)]
mod tests {
    use super::ensure_log_directory;

    #[test]
    fn ensures_the_runtime_log_directory_exists() {
        let root = tempfile::tempdir().expect("tempdir");
        let log_dir = root.path().join("logs");

        ensure_log_directory(&log_dir).expect("log directory");

        assert!(log_dir.is_dir());
    }
}
