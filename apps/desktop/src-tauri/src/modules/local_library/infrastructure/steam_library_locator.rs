use crate::modules::local_library::application::scan_local_library::LibraryDiscovery;
use crate::modules::local_library::domain::steam_path::dedupe_key;
use crate::modules::local_library::infrastructure::valve_kv::ValveKeyValueParser;
use crate::modules::local_library::{DiscoveryError, SteamLibrary, SteamRegistry};
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};

/// Gates a repeated failure log to the first failure after a success (or
/// idle): `should_warn(true)` warns only on the transition into failure and
/// flips the gate to failing; `should_warn(false)` resets the gate and never
/// warns. Interior-mutable (`AtomicBool`) so the locator keeps its `&self`
/// locator, its `Clone` derive, and `Send + Sync` for the Tauri runtime and
/// the watcher thread.
#[derive(Debug, Default)]
pub struct FailureLogGate {
    failing: AtomicBool,
}

impl Clone for FailureLogGate {
    /// Copies the current flag state; each clone warns on its own first
    /// transition into failure.
    fn clone(&self) -> Self {
        Self {
            failing: AtomicBool::new(self.failing.load(Ordering::SeqCst)),
        }
    }
}

impl FailureLogGate {
    /// A gate starting idle: the first failure warns.
    pub fn new() -> Self {
        Self::default()
    }

    /// Whether a warning should be emitted for this `failed` outcome.
    pub fn should_warn(&self, failed: bool) -> bool {
        if failed {
            !self.failing.swap(true, Ordering::SeqCst)
        } else {
            self.failing.store(false, Ordering::SeqCst);
            false
        }
    }
}

/// Discovers Steam libraries from Registry-reported install paths and the
/// `libraryfolders.vdf` of each installation.
///
/// Discovery reads only the Registry Steam locations and the declared
/// library folders; it never scans the whole disk.
#[derive(Clone)]
pub struct SteamLibraryLocator<R: SteamRegistry> {
    registry: R,
    /// Warns on discovery failure only when the failure is new (the watcher
    /// polls `locate` every second; a machine without Steam must not log a
    /// WARN every second).
    gate: FailureLogGate,
}

impl<R: SteamRegistry> SteamLibraryLocator<R> {
    /// Creates a locator over the given registry port, using the bounded
    /// Valve KeyValues parser for `libraryfolders.vdf` files.
    pub fn new(registry: R, _parser: ValveKeyValueParser) -> Self {
        Self {
            registry,
            gate: FailureLogGate::new(),
        }
    }

    /// Locates every usable Steam library on this machine.
    ///
    /// For each candidate install root, the root library is included when
    /// `<root>/steamapps` exists, and the numeric folder entries of
    /// `<root>/steamapps/libraryfolders.vdf` are parsed for their `path`
    /// values. Missing or malformed entries are skipped and discovery
    /// continues; [`DiscoveryError::SteamNotFound`] is returned only when
    /// no usable library remains.
    pub fn locate(&self) -> Result<Vec<SteamLibrary>, DiscoveryError> {
        // Counts only — candidate install paths are never logged, they are
        // personal local paths.
        let candidates = match self.registry.candidate_install_paths() {
            Ok(candidates) => candidates,
            Err(error) => {
                if self.gate.should_warn(true) {
                    log::warn!("steam library discovery failed: {error}");
                }
                return Err(error);
            }
        };
        log::debug!(
            "steam library discovery: {} registry candidate path(s)",
            candidates.len()
        );
        let mut libraries = Vec::new();
        let mut seen = HashSet::new();

        for candidate in candidates {
            let root = candidate;
            if !root.join("steamapps").is_dir() {
                continue;
            }
            if seen.insert(dedupe_key(&root)) {
                libraries.push(SteamLibrary::new(root.clone()));
            }
            Self::collect_declared_libraries(&root, &mut libraries, &mut seen);
        }

        if libraries.is_empty() {
            if self.gate.should_warn(true) {
                log::warn!("steam library discovery found no usable steam library");
            }
            Err(DiscoveryError::SteamNotFound)
        } else {
            self.gate.should_warn(false);
            Ok(libraries)
        }
    }

    /// Reads the numeric folder entries of `<root>/steamapps/libraryfolders.vdf`
    /// and appends each declared library whose `steamapps` directory exists.
    /// A missing file, a malformed file, a non-numeric folder key, or a
    /// folder without a usable `path` value is skipped.
    fn collect_declared_libraries(
        root: &Path,
        libraries: &mut Vec<SteamLibrary>,
        seen: &mut HashSet<String>,
    ) {
        let vdf_path = root.join("steamapps").join("libraryfolders.vdf");
        let Ok(text) = std::fs::read_to_string(&vdf_path) else {
            return;
        };
        let Ok(value) = ValveKeyValueParser::parse(&text) else {
            return;
        };
        let Some(folders) = value.object("libraryfolders") else {
            return;
        };
        for (key, folder) in folders.children() {
            if !is_numeric_folder_key(key) {
                continue;
            }
            let Some(path) = folder.string("path") else {
                continue;
            };
            let library_root = PathBuf::from(path);
            if !library_root.join("steamapps").is_dir() {
                continue;
            }
            if seen.insert(dedupe_key(&library_root)) {
                libraries.push(SteamLibrary::new(library_root));
            }
        }
    }
}

/// Whether `key` is a Steam folder index (a non-empty string of digits).
fn is_numeric_folder_key(key: &str) -> bool {
    !key.is_empty() && key.chars().all(|c| c.is_ascii_digit())
}

impl<R: SteamRegistry> LibraryDiscovery for SteamLibraryLocator<R> {
    /// Implements the scan port with the inherent discovery logic.
    fn locate(&self) -> Result<Vec<SteamLibrary>, DiscoveryError> {
        SteamLibraryLocator::locate(self)
    }
}

#[cfg(test)]
mod tests {
    use super::{FailureLogGate, SteamLibraryLocator};
    use crate::modules::local_library::domain::steam_path::{DiscoveryError, SteamRegistry};
    use crate::modules::local_library::infrastructure::valve_kv::ValveKeyValueParser;
    use std::path::{Path, PathBuf};
    use std::sync::{Mutex, MutexGuard};

    #[test]
    fn warns_on_the_first_failure_only() {
        let gate = FailureLogGate::new();

        assert!(gate.should_warn(true), "first failure must warn");
        assert!(
            !gate.should_warn(true),
            "a second failure in a row must not warn again"
        );
        assert!(
            !gate.should_warn(true),
            "repeated failures must stay silent"
        );
    }

    #[test]
    fn resets_on_success_so_the_next_failure_warns_again() {
        let gate = FailureLogGate::new();

        assert!(gate.should_warn(true));
        assert!(!gate.should_warn(false), "success never warns");
        assert!(
            gate.should_warn(true),
            "the failure after a success is a new transition and must warn"
        );
    }

    #[test]
    fn never_warns_while_idle_and_stays_quiet_until_a_failure() {
        let gate = FailureLogGate::new();

        assert!(!gate.should_warn(false));
        assert!(!gate.should_warn(false));
        assert!(
            gate.should_warn(true),
            "the first failure after idle is a transition and must warn"
        );
    }

    #[test]
    fn warns_on_every_transition_into_failure_through_alternating_outcomes() {
        let gate = FailureLogGate::new();

        assert!(gate.should_warn(true));
        assert!(!gate.should_warn(false));
        assert!(gate.should_warn(true));
        assert!(!gate.should_warn(false));
        assert!(gate.should_warn(true));
    }

    /// A registry fake that reports a fixed set of candidate install paths.
    /// Tests never touch the host Windows Registry.
    struct FakeSteamRegistry {
        paths: Vec<PathBuf>,
    }

    impl FakeSteamRegistry {
        fn with_paths(paths: Vec<PathBuf>) -> Self {
            Self { paths }
        }

        fn empty() -> Self {
            Self { paths: Vec::new() }
        }
    }

    impl SteamRegistry for FakeSteamRegistry {
        fn candidate_install_paths(&self) -> Result<Vec<PathBuf>, DiscoveryError> {
            Ok(self.paths.clone())
        }
    }

    #[test]
    fn finds_the_root_and_declared_library_folders_without_scanning_other_drives() {
        let registry = FakeSteamRegistry::with_paths(vec![PathBuf::from("C:/Steam")]);
        let root = tempdir_with_libraryfolders("C:/Steam", &["C:/Steam", "D:/SteamLibrary"]);
        let locator = SteamLibraryLocator::new(registry, ValveKeyValueParser);

        let libraries = locator.locate().unwrap();

        assert_eq!(libraries.len(), 2);
        assert!(libraries.iter().all(|library| library.steamapps().exists()));
        assert!(!libraries
            .iter()
            .any(|library| library.root().ends_with("C:/")));
        drop(root);
    }

    #[test]
    fn returns_not_found_when_registry_has_no_usable_steam_path() {
        let locator = SteamLibraryLocator::new(FakeSteamRegistry::empty(), ValveKeyValueParser);

        assert!(matches!(
            locator.locate(),
            Err(DiscoveryError::SteamNotFound)
        ));
    }

    #[test]
    fn returns_not_found_when_no_candidate_has_a_steamapps_directory() {
        let registry = FakeSteamRegistry::with_paths(vec![
            PathBuf::from("C:/Steam"),
            PathBuf::from("D:/SteamLibrary"),
        ]);
        let root = tempdir_empty();
        let locator = SteamLibraryLocator::new(registry, ValveKeyValueParser);

        assert!(matches!(
            locator.locate(),
            Err(DiscoveryError::SteamNotFound)
        ));
        drop(root);
    }

    #[test]
    fn skips_non_numeric_and_pathless_vdf_entries_but_keeps_good_libraries() {
        let registry = FakeSteamRegistry::with_paths(vec![PathBuf::from("C:/Steam")]);
        // Real libraryfolders.vdf files mix non-numeric keys (contentid)
        // and numeric folders without a `path` value; both must be skipped
        // while the well-formed folder is still discovered.
        let vdf = r#""libraryfolders"
{
	"contentid"		"2692709841571594013"
	"1"
	{
		"nApps"		"0"
	}
	"2"
	{
		"path"		"D:/GoodLibrary"
	}
}
"#;
        let root = tempdir_with_vdf("C:/Steam", vdf, &["D:/GoodLibrary"]);
        let locator = SteamLibraryLocator::new(registry, ValveKeyValueParser);

        let libraries = locator.locate().unwrap();

        assert_eq!(libraries.len(), 2); // the root plus the one good folder
        assert!(libraries.iter().all(|library| library.steamapps().exists()));
        drop(root);
    }

    #[test]
    fn collapses_trailing_separator_duplicates_into_one_library() {
        let registry = FakeSteamRegistry::with_paths(vec![
            PathBuf::from("C:/Steam"),
            PathBuf::from("C:/Steam/"),
        ]);
        let root = tempdir_with_libraryfolders("C:/Steam", &[]);
        let locator = SteamLibraryLocator::new(registry, ValveKeyValueParser);

        let libraries = locator.locate().unwrap();

        assert_eq!(libraries.len(), 1); // "C:/Steam/" is not a new library
        drop(root);
    }

    /// Serializes the chdir-based temp-dir helpers. `set_current_dir` is
    /// process-global, so only one test may run with a changed working
    /// directory at a time; without the lock, tests that chdir in parallel
    /// race on `tempdir_empty` (which drops its guard while another test
    /// is mid-setup) and corrupt each other's fixtures.
    ///
    /// Constraint for the whole crate: every test must use absolute paths
    /// for runtime relative-path I/O, or go through this guarded helper
    /// (which restores the working directory on drop). Task 4's manifest
    /// tests must not do bare relative I/O, or they would race with this
    /// helper's `set_current_dir`.
    static CWD_LOCK: Mutex<()> = Mutex::new(());

    /// A temporary working directory holding a fake Steam install that
    /// restores the previous working directory and removes itself on drop.
    ///
    /// The locator resolves the fixture's Windows-style paths relative to
    /// the process working directory, so the helper changes into the temp
    /// directory for the lifetime of the guard. The guard holds the
    /// [`CWD_LOCK`] until it is dropped, so the working directory and the
    /// temp dir are exclusive to this test.
    struct TempLibraryDir {
        _lock: MutexGuard<'static, ()>,
        original: PathBuf,
        temp: PathBuf,
    }

    impl Drop for TempLibraryDir {
        fn drop(&mut self) {
            let _ = std::env::set_current_dir(&self.original);
            let _ = std::fs::remove_dir_all(&self.temp);
        }
    }

    /// Creates `<root>/steamapps/libraryfolders.vdf` declaring `folders`,
    /// plus a `steamapps` directory under every declared folder, inside a
    /// fresh temp directory that becomes the working directory.
    fn tempdir_with_libraryfolders(root: &str, folders: &[&str]) -> TempLibraryDir {
        let vdf = build_libraryfolders_vdf(folders);
        tempdir_with_vdf(root, &vdf, folders)
    }

    /// Creates `<root>/steamapps` containing the given raw `vdf` text,
    /// plus a `steamapps` directory under every folder in `dirs`, inside a
    /// fresh temp directory that becomes the working directory.
    fn tempdir_with_vdf(root: &str, vdf: &str, dirs: &[&str]) -> TempLibraryDir {
        let guard = enter_temp_dir();

        let steamapps = Path::new(root).join("steamapps");
        std::fs::create_dir_all(&steamapps).expect("create root steamapps dir");
        std::fs::write(steamapps.join("libraryfolders.vdf"), vdf)
            .expect("write libraryfolders.vdf");
        for folder in dirs {
            std::fs::create_dir_all(Path::new(folder).join("steamapps"))
                .expect("create declared library steamapps dir");
        }
        guard
    }

    /// Creates a fresh temp directory that becomes the working directory,
    /// with no Steam fixtures in it.
    fn tempdir_empty() -> TempLibraryDir {
        enter_temp_dir()
    }

    /// Enters a fresh unique temp directory and returns a guard that
    /// restores the previous working directory and removes the temp
    /// directory on drop. The guard holds [`CWD_LOCK`] for its lifetime.
    fn enter_temp_dir() -> TempLibraryDir {
        use std::sync::atomic::{AtomicU64, Ordering};

        static COUNTER: AtomicU64 = AtomicU64::new(0);

        let _lock = CWD_LOCK.lock().expect("temp-dir lock poisoned");
        let original = std::env::current_dir().expect("test working directory");
        let temp = std::env::temp_dir().join(format!(
            "launcher-steam-test-{}-{}",
            std::process::id(),
            COUNTER.fetch_add(1, Ordering::Relaxed)
        ));
        let guard = TempLibraryDir {
            _lock,
            original,
            temp: temp.clone(),
        };
        let _ = std::fs::remove_dir_all(&temp);
        std::fs::create_dir_all(&temp).expect("create temp dir");
        std::env::set_current_dir(&temp).expect("switch to temp dir");
        guard
    }

    /// Renders a Steam-shaped `libraryfolders.vdf` whose numeric folder
    /// entries carry the given `path` values.
    fn build_libraryfolders_vdf(folders: &[&str]) -> String {
        let mut vdf = String::from("\"libraryfolders\"\n{\n");
        for (index, folder) in folders.iter().enumerate() {
            let escaped = folder.replace('\\', "\\\\").replace('"', "\\\"");
            vdf.push_str(&format!(
                "\t\"{index}\"\n\t{{\n\t\t\"path\"\t\t\"{escaped}\"\n\t}}\n"
            ));
        }
        vdf.push_str("}\n");
        vdf
    }
}
