//! Local launch history: remembers the instant of the last completed launch
//! per provider entry, persisted to a JSON file in the app data directory.
//!
//! The history is desktop-local by design: it is only ever read back through
//! the `launch_history_get` command and is never included in any API
//! request. Persistence is atomic (temp file + rename), so a partial write
//! can never corrupt the last good file; a missing or unreadable file simply
//! starts empty.

use crate::modules::local_library::application::local_snapshot_dto::ProviderDto;
use crate::modules::local_library::domain::local_game::Provider;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fmt;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

/// Current on-disk history format version.
const HISTORY_VERSION: u32 = 1;

/// Frontend-facing projection of the recorded history.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LaunchHistoryEntryDto {
    /// The provider the entry belongs to.
    pub provider: ProviderDto,
    /// The provider-side numeric identifier.
    pub external_game_id: u32,
    /// The instant of the last completed launch, ISO 8601 UTC.
    pub last_launched_at: String,
}

/// The history snapshot sent to the frontend by `launch_history_get`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LaunchHistoryDto {
    /// Every recorded entry, sorted by external game id then last launch
    /// instant, for determinism.
    pub entries: Vec<LaunchHistoryEntryDto>,
}

/// The on-disk shape of the history file.
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PersistedHistory {
    version: u32,
    entries: Vec<PersistedEntry>,
}

/// One persisted entry; provider uses the canonical wire vocabulary.
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PersistedEntry {
    provider: ProviderDto,
    external_game_id: u32,
    last_launched_at: String,
}

/// Errors from persisting the launch history.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LaunchHistoryError {
    detail: String,
}

impl LaunchHistoryError {
    fn new(detail: impl Into<String>) -> Self {
        Self {
            detail: detail.into(),
        }
    }
}

impl fmt::Display for LaunchHistoryError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.detail)
    }
}

impl std::error::Error for LaunchHistoryError {}

/// Persists and serves the local launch history.
///
/// The store keeps the entries in memory (the snapshot the commands serve)
/// and mirrors them to `path` on every record. Persistence is best-effort:
/// a failed write is reported to the caller (which logs and continues) and
/// never loses the in-memory record for the current session.
#[derive(Debug)]
pub struct LaunchHistoryStore {
    /// The history file; `None` keeps the store in-memory only.
    path: Option<PathBuf>,
    entries: Mutex<HashMap<(Provider, u32), String>>,
}

impl LaunchHistoryStore {
    /// Loads the history file at `path`.
    ///
    /// A missing file, an unreadable file, or a file in an unknown format
    /// yields an empty store — a corrupt history must never prevent the
    /// Fuse Launcher from starting.
    pub fn load(path: PathBuf) -> Self {
        let entries = load_entries(&path);
        Self {
            path: Some(path),
            entries: Mutex::new(entries),
        }
    }

    /// A store that keeps history only in memory and never touches the disk.
    ///
    /// Used as the production fallback when the app data directory cannot be
    /// resolved, and by tests that do not care about persistence.
    pub fn in_memory() -> Self {
        Self {
            path: None,
            entries: Mutex::new(HashMap::new()),
        }
    }

    /// Records a completed launch for `external_game_id`, updating the entry
    /// when one already exists, and persists the store.
    ///
    /// A persistence failure is returned as an error so the caller can log
    /// it; the in-memory record is kept regardless.
    pub fn record(
        &self,
        provider: Provider,
        external_game_id: u32,
        now: SystemTime,
    ) -> Result<(), LaunchHistoryError> {
        let instant = format_iso_utc(now);
        self.entries
            .lock()
            .expect("launch history mutex poisoned")
            .insert((provider, external_game_id), instant);
        self.persist()
    }

    /// The recorded history as the frontend-facing DTO.
    pub fn entries(&self) -> LaunchHistoryDto {
        let entries = self.entries.lock().expect("launch history mutex poisoned");
        let mut list: Vec<LaunchHistoryEntryDto> = entries
            .iter()
            .map(
                |((provider, external_game_id), last_launched_at)| LaunchHistoryEntryDto {
                    provider: ProviderDto::from(*provider),
                    external_game_id: *external_game_id,
                    last_launched_at: last_launched_at.clone(),
                },
            )
            .collect();
        list.sort_by(|a, b| {
            (a.external_game_id, &a.last_launched_at)
                .cmp(&(b.external_game_id, &b.last_launched_at))
        });
        LaunchHistoryDto { entries: list }
    }

    /// Mirrors the in-memory entries to the history file atomically.
    fn persist(&self) -> Result<(), LaunchHistoryError> {
        let Some(path) = &self.path else {
            return Ok(());
        };
        let entries = self.entries.lock().expect("launch history mutex poisoned");
        let persisted: Vec<PersistedEntry> = entries
            .iter()
            .map(
                |((provider, external_game_id), last_launched_at)| PersistedEntry {
                    provider: ProviderDto::from(*provider),
                    external_game_id: *external_game_id,
                    last_launched_at: last_launched_at.clone(),
                },
            )
            .collect();
        let payload = serde_json::to_string_pretty(&PersistedHistory {
            version: HISTORY_VERSION,
            entries: persisted,
        })
        .map_err(|error| {
            LaunchHistoryError::new(format!("could not serialize the launch history: {error}"))
        })?;
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).map_err(|error| {
                LaunchHistoryError::new(format!(
                    "could not create the launch history directory {}: {error}",
                    parent.display()
                ))
            })?;
        }
        let tmp = path.with_extension("json.tmp");
        std::fs::write(&tmp, payload).map_err(|error| {
            LaunchHistoryError::new(format!(
                "could not write the launch history temp file {}: {error}",
                tmp.display()
            ))
        })?;
        std::fs::rename(&tmp, path).map_err(|error| {
            LaunchHistoryError::new(format!(
                "could not move the launch history into place {}: {error}",
                path.display()
            ))
        })?;
        Ok(())
    }
}

/// Reads the history file into the in-memory map; any problem yields empty.
fn load_entries(path: &Path) -> HashMap<(Provider, u32), String> {
    let Ok(text) = std::fs::read_to_string(path) else {
        return HashMap::new();
    };
    match serde_json::from_str::<PersistedHistory>(&text) {
        Ok(history) if history.version == HISTORY_VERSION => history
            .entries
            .into_iter()
            .map(|entry| {
                (
                    (Provider::from(entry.provider), entry.external_game_id),
                    entry.last_launched_at,
                )
            })
            .collect(),
        Ok(_) => {
            log::warn!(
                "launch history file {:?} has an unknown version; starting empty",
                path
            );
            HashMap::new()
        }
        Err(error) => {
            log::warn!(
                "launch history file {:?} could not be parsed: {error}; starting empty",
                path
            );
            HashMap::new()
        }
    }
}

/// Formats a `SystemTime` instant as an ISO 8601 UTC timestamp.
///
/// The civil-from-days arithmetic is the standard Hinnant algorithm; the
/// output is second-precision (`YYYY-MM-DDTHH:MM:SSZ`) and sorts
/// lexicographically like the remote `lastActivityAt` instants.
pub fn format_iso_utc(now: SystemTime) -> String {
    let secs = now.duration_since(UNIX_EPOCH).unwrap_or_default().as_secs() as i64;
    let days = secs.div_euclid(86_400);
    let rem = secs.rem_euclid(86_400);
    let (hour, minute, second) = (rem / 3600, (rem % 3600) / 60, rem % 60);

    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = if month <= 2 { y + 1 } else { y };

    format!("{year:04}-{month:02}-{day:02}T{hour:02}:{minute:02}:{second:02}Z")
}

#[cfg(test)]
mod tests {
    use super::{format_iso_utc, LaunchHistoryDto, LaunchHistoryEntryDto, LaunchHistoryStore};
    use crate::modules::local_library::application::local_snapshot_dto::ProviderDto;
    use crate::modules::local_library::domain::local_game::Provider;
    use std::path::PathBuf;
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::time::{Duration, SystemTime, UNIX_EPOCH};

    /// A fixed `SystemTime` instant; absolute paths only, per the crate-wide
    /// constraint from the locator tests.
    fn instant(secs: u64) -> SystemTime {
        UNIX_EPOCH + Duration::from_secs(secs)
    }

    /// A temporary directory for one history store; removes itself on drop.
    struct TempHistoryDir {
        path: PathBuf,
        dir: PathBuf,
    }

    impl TempHistoryDir {
        fn new() -> Self {
            static COUNTER: AtomicU64 = AtomicU64::new(0);
            let dir = std::env::temp_dir().join(format!(
                "fuse-launcher-history-test-{}-{}",
                std::process::id(),
                COUNTER.fetch_add(1, Ordering::Relaxed)
            ));
            let _ = std::fs::remove_dir_all(&dir);
            std::fs::create_dir_all(&dir).expect("create history fixture dir");
            Self {
                path: dir.join("launch_history.json"),
                dir,
            }
        }
    }

    impl Drop for TempHistoryDir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.dir);
        }
    }

    fn steam(
        provider: ProviderDto,
        external_game_id: u32,
        last_launched_at: &str,
    ) -> LaunchHistoryEntryDto {
        LaunchHistoryEntryDto {
            provider,
            external_game_id,
            last_launched_at: last_launched_at.to_string(),
        }
    }

    #[test]
    fn formats_known_instants_as_iso_utc() {
        for (secs, expected) in [
            (0, "1970-01-01T00:00:00Z"),
            (946_684_800, "2000-01-01T00:00:00Z"),
            (1_707_200_000, "2024-02-06T06:13:20Z"),
            (1_787_961_600, "2026-08-29T00:00:00Z"),
            (1_788_012_459, "2026-08-29T14:07:39Z"),
            (2_147_483_647, "2038-01-19T03:14:07Z"),
        ] {
            assert_eq!(format_iso_utc(instant(secs)), expected, "epoch {secs}");
        }
    }

    #[test]
    fn persists_and_recovers_entries_across_store_instances() {
        let fixture = TempHistoryDir::new();
        {
            let store = LaunchHistoryStore::load(fixture.path.clone());
            store
                .record(Provider::Steam, 730, instant(1_788_012_459))
                .unwrap();
            store
                .record(Provider::Steam, 570, instant(1_788_012_450))
                .unwrap();
        }
        // A fresh store instance over the same file must recover both
        // entries: the history survives a Fuse Launcher restart.
        let store = LaunchHistoryStore::load(fixture.path.clone());
        assert_eq!(
            store.entries(),
            LaunchHistoryDto {
                entries: vec![
                    steam(ProviderDto::Steam, 570, "2026-08-29T14:07:30Z"),
                    steam(ProviderDto::Steam, 730, "2026-08-29T14:07:39Z"),
                ],
            }
        );
    }

    #[test]
    fn record_updates_the_last_launched_at_of_an_existing_entry() {
        let fixture = TempHistoryDir::new();
        let store = LaunchHistoryStore::load(fixture.path.clone());

        store
            .record(Provider::Steam, 730, instant(1_788_012_459))
            .unwrap();
        store
            .record(Provider::Steam, 730, instant(1_788_012_500))
            .unwrap();

        assert_eq!(
            store.entries(),
            LaunchHistoryDto {
                entries: vec![steam(ProviderDto::Steam, 730, "2026-08-29T14:08:20Z")],
            }
        );
        // The file on disk matches the updated entry.
        let reloaded = LaunchHistoryStore::load(fixture.path.clone());
        assert_eq!(reloaded.entries(), store.entries());
    }

    #[test]
    fn atomic_write_leaves_no_temp_file_and_a_valid_file() {
        let fixture = TempHistoryDir::new();
        let store = LaunchHistoryStore::load(fixture.path.clone());

        store
            .record(Provider::Steam, 730, instant(1_788_012_459))
            .unwrap();

        // The committed file is complete, versioned JSON.
        let raw = std::fs::read_to_string(&fixture.path).expect("history file must exist");
        let parsed: serde_json::Value =
            serde_json::from_str(&raw).expect("history file must be valid json");
        assert_eq!(parsed["version"], 1);
        assert_eq!(parsed["entries"][0]["externalGameId"], 730);
        assert_eq!(parsed["entries"][0]["provider"], "steam");
        assert_eq!(
            parsed["entries"][0]["lastLaunchedAt"],
            "2026-08-29T14:07:39Z"
        );
        // The temp file is renamed away: no partial artifact remains.
        assert!(
            !fixture.path.with_extension("json.tmp").exists(),
            "no temp file may remain after a successful record"
        );
    }

    #[test]
    fn a_corrupt_history_file_starts_empty_and_recovers_on_the_next_record() {
        let fixture = TempHistoryDir::new();
        // A partial write (as a crash mid-write could leave) must not break
        // the store: it starts empty and the next record rewrites the file.
        std::fs::write(&fixture.path, "{\"version\": 1, \"entries\": [\"truncated").unwrap();

        let store = LaunchHistoryStore::load(fixture.path.clone());
        assert_eq!(store.entries().entries, Vec::new());

        store
            .record(Provider::Steam, 730, instant(1_788_012_459))
            .unwrap();
        assert_eq!(
            store.entries(),
            LaunchHistoryDto {
                entries: vec![steam(ProviderDto::Steam, 730, "2026-08-29T14:07:39Z")],
            }
        );
        let reloaded = LaunchHistoryStore::load(fixture.path.clone());
        assert_eq!(reloaded.entries(), store.entries());
    }

    #[test]
    fn an_unknown_history_version_starts_empty() {
        let fixture = TempHistoryDir::new();
        std::fs::write(
            &fixture.path,
            r#"{"version": 99, "entries": [{"provider": "steam", "externalGameId": 730, "lastLaunchedAt": "2026-08-29T14:07:39Z"}]}"#,
        )
        .unwrap();

        let store = LaunchHistoryStore::load(fixture.path.clone());

        assert_eq!(store.entries().entries, Vec::new());
    }

    #[test]
    fn a_missing_history_file_starts_empty() {
        let fixture = TempHistoryDir::new();

        let store = LaunchHistoryStore::load(fixture.path.clone());

        assert_eq!(store.entries().entries, Vec::new());
    }

    #[test]
    fn an_in_memory_store_never_writes_to_the_disk() {
        let fixture = TempHistoryDir::new();
        let store = LaunchHistoryStore::in_memory();

        store
            .record(Provider::Steam, 730, instant(1_788_012_459))
            .unwrap();

        assert_eq!(
            store.entries(),
            LaunchHistoryDto {
                entries: vec![steam(ProviderDto::Steam, 730, "2026-08-29T14:07:39Z")],
            }
        );
        assert!(
            !fixture.path.exists(),
            "an in-memory store must never create a history file"
        );
    }
}
