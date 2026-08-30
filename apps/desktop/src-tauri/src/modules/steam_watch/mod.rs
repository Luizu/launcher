//! Watches the known Steam library sources for manifest changes.
//!
//! The watcher is deliberately limited: it observes only the `steamapps`
//! directories the locator already knows (plus the `libraryfolders.vdf` of
//! each known source, so a newly declared library folder also triggers a
//! rescan). It never watches executables, arbitrary directories, or the
//! whole disk. Changes are detected by bounded polling — comparing the set
//! of manifest file names, sizes, and mtimes — and coalesced by debounce:
//! rapid changes settle for [`WATCH_DEBOUNCE_MS`] before exactly one scan
//! runs, and a minimum interval between triggered scans bounds the worst
//! case under continuous churn.
//!
//! Every successful scan result is written into the shared snapshot (the
//! same buffer `local_library_scan` writes) and published to the frontend
//! through the [`LOCAL_LIBRARY_CHANGED_EVENT`] event with the path-free
//! `LocalSnapshotDto` shape. A failed scan keeps the last usable snapshot —
//! stale-until-success, exactly like the manual scan command.

use crate::modules::local_library::application::local_snapshot_dto::LocalSnapshotDto;
use crate::modules::local_library::application::scan_local_library::{
    LibraryDiscovery, ScanLocalLibrary,
};
use crate::modules::local_library::domain::local_library_snapshot::LocalLibrarySnapshot;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

/// Tauri event carrying a fresh path-free local snapshot.
pub const LOCAL_LIBRARY_CHANGED_EVENT: &str = "local-library-changed";

/// How often the watcher compares the known sources (bounded polling).
pub const WATCH_POLL_INTERVAL_MS: u64 = 1_000;

/// How long changes must settle before one scan is triggered.
pub const WATCH_DEBOUNCE_MS: u64 = 2_000;

/// Minimum interval between triggered scans (guards unlimited sequences).
pub const WATCH_MIN_INTERVAL_MS: u64 = 5_000;

/// Port for the watcher's time source; production uses wall clock + real
/// sleep, tests drive a fake clock deterministically.
pub trait WatchClock: Send + 'static {
    /// The current instant.
    fn now(&self) -> SystemTime;
    /// Pauses the watcher loop between polls.
    fn sleep(&self, duration: Duration);
}

/// The production clock: wall time and real thread sleep.
#[derive(Debug, Default)]
pub struct SystemWatchClock;

impl WatchClock for SystemWatchClock {
    fn now(&self) -> SystemTime {
        SystemTime::now()
    }

    fn sleep(&self, duration: Duration) {
        std::thread::sleep(duration);
    }
}

/// Port for publishing a fresh scan result to the frontend.
pub trait WatcherEmitter: Send + 'static {
    /// Publishes `dto` (e.g. as a Tauri event); errors are logged by the
    /// watcher and never crash the app.
    fn emit(&self, dto: &LocalSnapshotDto) -> Result<(), String>;
}

/// One observed manifest file in a known source: identity plus a change
/// fingerprint (size and mtime).
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord)]
struct ManifestFingerprint {
    /// The known `steamapps` directory holding the file.
    dir: PathBuf,
    /// The file name (`appmanifest_<appid>.acf` or `libraryfolders.vdf`).
    name: String,
    /// The file size in bytes.
    len: u64,
    /// The file modification time.
    modified: SystemTime,
}

/// Whether a file name inside a known source is watched.
fn is_watched_name(name: &str) -> bool {
    name == "libraryfolders.vdf" || (name.starts_with("appmanifest_") && name.ends_with(".acf"))
}

/// Watches the known Steam sources and triggers scans on relevant changes.
///
/// The watcher is a plain struct owning its loop state; the app setup moves
/// it into a `std::thread` and the process lifetime owns it (the thread dies
/// with the process — no agent keeps watching after the launcher closes).
/// [`Self::tick`] runs one poll iteration so tests can drive the loop with a
/// fake clock; [`Self::run`] loops `tick` + sleep forever.
pub struct SteamWatcher<
    L: LibraryDiscovery + Clone + Send + 'static,
    C: WatchClock,
    E: WatcherEmitter,
> {
    locator: L,
    scanner: ScanLocalLibrary<L>,
    /// The shared snapshot the watcher writes on successful scans; the same
    /// buffer the scan command and the action service read.
    snapshot: Arc<Mutex<LocalLibrarySnapshot>>,
    emitter: E,
    debounce: Duration,
    min_interval: Duration,
    poll_interval: Duration,
    clock: C,
    /// The last observed fingerprint set; `None` until the first tick
    /// establishes the baseline (startup never triggers a scan).
    observed: Option<Vec<ManifestFingerprint>>,
    /// When the last relevant change was first observed.
    last_change_at: Option<SystemTime>,
    /// When the last scan was triggered.
    last_scan_at: Option<SystemTime>,
    /// A change is waiting for debounce + interval before scanning.
    pending: bool,
}

impl<L: LibraryDiscovery + Clone + Send + 'static, C: WatchClock, E: WatcherEmitter>
    SteamWatcher<L, C, E>
{
    /// Creates the watcher with the default timing limits.
    pub fn new(
        locator: L,
        snapshot: Arc<Mutex<LocalLibrarySnapshot>>,
        emitter: E,
        clock: C,
    ) -> Self {
        let scanner = ScanLocalLibrary::new(locator.clone());
        Self {
            locator,
            scanner,
            snapshot,
            emitter,
            debounce: Duration::from_millis(WATCH_DEBOUNCE_MS),
            min_interval: Duration::from_millis(WATCH_MIN_INTERVAL_MS),
            poll_interval: Duration::from_millis(WATCH_POLL_INTERVAL_MS),
            clock,
            observed: None,
            last_change_at: None,
            last_scan_at: None,
            pending: false,
        }
    }

    /// Overrides the timing limits (debounce, minimum scan interval, poll
    /// interval) so callers can tune the watcher. Production uses the
    /// defaults, so only the tests reach this tuning knob.
    #[allow(dead_code)]
    pub fn with_timing(
        mut self,
        debounce: Duration,
        min_interval: Duration,
        poll_interval: Duration,
    ) -> Self {
        self.debounce = debounce;
        self.min_interval = min_interval;
        self.poll_interval = poll_interval;
        self
    }

    /// The watcher loop: poll, sleep, repeat, forever.
    pub fn run(mut self) -> ! {
        loop {
            self.tick();
            self.clock.sleep(self.poll_interval);
        }
    }

    /// One poll iteration: observe the known sources, coalesce changes by
    /// debounce, and trigger a scan when the change settled and the minimum
    /// interval allows. Returns whether a scan was triggered this tick.
    pub fn tick(&mut self) -> bool {
        let now = self.clock.now();
        let current = self.observe();
        let is_baseline = self.observed.is_none();
        let changed = !is_baseline && self.observed.as_ref() != Some(&current);
        self.observed = Some(current);
        if changed {
            // A relevant change: the debounce timer restarts so rapid
            // changes coalesce into one settled scan.
            self.pending = true;
            self.last_change_at = Some(now);
        }
        if self.pending {
            let debounced = self
                .last_change_at
                .is_some_and(|at| self.elapsed_since(now, at) >= self.debounce);
            let interval_ok = self
                .last_scan_at
                .is_none_or(|at| self.elapsed_since(now, at) >= self.min_interval);
            if debounced && interval_ok {
                self.scan();
                self.pending = false;
                self.last_scan_at = Some(now);
                return true;
            }
        }
        false
    }

    /// Observes the current fingerprint set of the known sources.
    ///
    /// Only the `steamapps` directories of the declared libraries are
    /// observed, and only `appmanifest_*.acf` files plus `libraryfolders.vdf`
    /// count. A source that cannot be read contributes nothing this tick; a
    /// library that cannot be located contributes nothing either — the next
    /// scan attempt reports the failure while the last snapshot stays usable.
    fn observe(&self) -> Vec<ManifestFingerprint> {
        let mut fingerprints = Vec::new();
        let Ok(libraries) = self.locator.locate() else {
            return fingerprints;
        };
        for library in &libraries {
            let steamapps = library.steamapps();
            let Ok(entries) = std::fs::read_dir(&steamapps) else {
                log::debug!(
                    "watcher: steamapps directory of a known library could not be read; skipping"
                );
                continue;
            };
            for entry in entries.flatten() {
                let Some(name) = entry.file_name().to_str().map(str::to_string) else {
                    continue;
                };
                if !is_watched_name(&name) {
                    continue;
                }
                let Ok(metadata) = entry.metadata() else {
                    continue;
                };
                if !metadata.is_file() {
                    continue;
                }
                fingerprints.push(ManifestFingerprint {
                    dir: steamapps.clone(),
                    name,
                    len: metadata.len(),
                    modified: metadata.modified().unwrap_or(UNIX_EPOCH),
                });
            }
        }
        fingerprints.sort();
        fingerprints
    }

    /// Runs one scan and publishes the result; failures keep the snapshot.
    ///
    /// Stale-until-success, exactly like the manual scan command: the shared
    /// snapshot is only ever overwritten by a successful scan, and the event
    /// is only published for a successful scan.
    fn scan(&self) {
        match self.scanner.execute() {
            Ok(snapshot) => {
                log::info!(
                    "watcher: library scan produced {} games; publishing",
                    snapshot.games().len()
                );
                *self.snapshot.lock().expect("snapshot mutex poisoned") = snapshot.clone();
                let dto = LocalSnapshotDto::from(&snapshot);
                if let Err(error) = self.emitter.emit(&dto) {
                    log::warn!(
                        "watcher: could not publish the local-library-changed event: {error}"
                    );
                }
            }
            Err(error) => {
                log::warn!(
                    "watcher: library scan failed: {error}; keeping the last usable snapshot"
                );
            }
        }
    }

    /// Seconds elapsed between `now` and `anchor`; a backwards clock reads 0.
    fn elapsed_since(&self, now: SystemTime, anchor: SystemTime) -> Duration {
        now.duration_since(anchor).unwrap_or_default()
    }
}

#[cfg(test)]
mod tests {
    use super::{
        SteamWatcher, WatchClock, WatcherEmitter, WATCH_DEBOUNCE_MS, WATCH_MIN_INTERVAL_MS,
    };
    use crate::modules::local_library::application::local_snapshot_dto::LocalSnapshotDto;
    use crate::modules::local_library::application::scan_local_library::LibraryDiscovery;
    use crate::modules::local_library::domain::local_library_snapshot::LocalLibrarySnapshot;
    use crate::modules::local_library::domain::steam_path::{DiscoveryError, SteamLibrary};
    use std::path::PathBuf;
    use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
    use std::sync::{Arc, Mutex};
    use std::time::{Duration, SystemTime, UNIX_EPOCH};

    fn instant(secs: u64) -> SystemTime {
        UNIX_EPOCH + Duration::from_secs(secs)
    }

    /// A fake clock the tests advance explicitly; `sleep` is a no-op because
    /// tests drive [`SteamWatcher::tick`] directly. The cell is shared, so a
    /// clone handed to the watcher still observes later advances.
    #[derive(Debug, Clone)]
    struct FakeWatchClock {
        now: Arc<Mutex<SystemTime>>,
    }

    impl FakeWatchClock {
        fn at(secs: u64) -> Self {
            Self {
                now: Arc::new(Mutex::new(instant(secs))),
            }
        }

        fn advance(&self, secs: u64) {
            *self.now.lock().unwrap() += Duration::from_secs(secs);
        }
    }

    impl WatchClock for FakeWatchClock {
        fn now(&self) -> SystemTime {
            *self.now.lock().unwrap()
        }

        fn sleep(&self, _duration: Duration) {}
    }

    /// A fake emitter recording every published snapshot.
    #[derive(Debug, Clone)]
    struct FakeEmitter {
        emitted: Arc<Mutex<Vec<LocalSnapshotDto>>>,
    }

    impl FakeEmitter {
        fn new() -> Self {
            Self {
                emitted: Arc::new(Mutex::new(Vec::new())),
            }
        }

        fn count(&self) -> usize {
            self.emitted.lock().expect("emitter mutex poisoned").len()
        }

        fn games_of(&self, index: usize) -> Vec<String> {
            self.emitted.lock().expect("emitter mutex poisoned")[index]
                .games
                .iter()
                .map(|game| game.name.clone())
                .collect()
        }
    }

    impl WatcherEmitter for FakeEmitter {
        fn emit(&self, dto: &LocalSnapshotDto) -> Result<(), String> {
            self.emitted
                .lock()
                .expect("emitter mutex poisoned")
                .push(dto.clone());
            Ok(())
        }
    }

    /// A temporary Steam library fixture: a known `steamapps` directory plus
    /// an optional unrelated directory that must never be watched.
    struct WatchFixture {
        root: PathBuf,
        steamapps: PathBuf,
        unrelated: PathBuf,
    }

    impl WatchFixture {
        fn new() -> Self {
            static COUNTER: AtomicU64 = AtomicU64::new(0);
            let root = std::env::temp_dir().join(format!(
                "launcher-watch-test-{}-{}",
                std::process::id(),
                COUNTER.fetch_add(1, Ordering::Relaxed)
            ));
            let _ = std::fs::remove_dir_all(&root);
            let steamapps = root.join("steamapps");
            let unrelated = root.join("unrelated");
            std::fs::create_dir_all(&steamapps).expect("create fixture steamapps dir");
            std::fs::create_dir_all(&unrelated).expect("create unrelated fixture dir");
            Self {
                root,
                steamapps,
                unrelated,
            }
        }

        /// Writes a fully installed manifest for `app_id`.
        fn write_manifest(&self, app_id: u32) {
            let manifest = format!(
                "\"AppState\"\n{{\n\t\"appid\"\t\t\"{app_id}\"\n\t\"name\"\t\t\"Game {app_id}\"\n\t\"StateFlags\"\t\t\"4\"\n\t\"installdir\"\t\t\"game_{app_id}\"\n}}\n"
            );
            std::fs::write(
                self.steamapps.join(format!("appmanifest_{app_id}.acf")),
                manifest,
            )
            .expect("write manifest fixture");
            std::fs::create_dir_all(self.steamapps.join("common").join(format!("game_{app_id}")))
                .expect("create install dir fixture");
        }

        /// Removes a manifest file.
        fn remove_manifest(&self, app_id: u32) {
            std::fs::remove_file(self.steamapps.join(format!("appmanifest_{app_id}.acf")))
                .expect("remove manifest fixture");
        }

        /// Writes a non-manifest file inside the known source; the watcher
        /// must ignore it.
        fn write_foreign_file(&self, name: &str, content: &str) {
            std::fs::write(self.steamapps.join(name), content).expect("write foreign fixture");
        }

        /// Writes a manifest outside every known source; never watched.
        fn write_unrelated_manifest(&self, app_id: u32) {
            let manifest = format!(
                "\"AppState\"\n{{\n\t\"appid\"\t\t\"{app_id}\"\n\t\"name\"\t\t\"Alien {app_id}\"\n\t\"StateFlags\"\t\t\"4\"\n\t\"installdir\"\t\t\"alien_{app_id}\"\n}}\n"
            );
            std::fs::write(
                self.unrelated.join(format!("appmanifest_{app_id}.acf")),
                manifest,
            )
            .expect("write unrelated manifest fixture");
        }

        /// Writes a `libraryfolders.vdf` into the known source.
        fn write_libraryfolders(&self, content: &str) {
            std::fs::write(self.steamapps.join("libraryfolders.vdf"), content)
                .expect("write libraryfolders fixture");
        }
    }

    impl Drop for WatchFixture {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.root);
        }
    }

    /// A discovery fake reporting exactly the known fixture library; the
    /// shared failure flag lets a test break and repair discovery mid-run.
    #[derive(Clone)]
    struct FakeDiscovery {
        libraries: Vec<SteamLibrary>,
        fail: Arc<AtomicBool>,
    }

    impl FakeDiscovery {
        fn fail_locate(&self) {
            self.fail.store(true, Ordering::SeqCst);
        }

        fn recover_locate(&self) {
            self.fail.store(false, Ordering::SeqCst);
        }
    }

    impl LibraryDiscovery for FakeDiscovery {
        fn locate(&self) -> Result<Vec<SteamLibrary>, DiscoveryError> {
            if self.fail.load(Ordering::SeqCst) {
                return Err(DiscoveryError::SteamNotFound);
            }
            Ok(self.libraries.clone())
        }
    }

    fn discovery(fixture: &WatchFixture) -> FakeDiscovery {
        FakeDiscovery {
            libraries: vec![SteamLibrary::new(fixture.root.clone())],
            fail: Arc::new(AtomicBool::new(false)),
        }
    }

    /// Builds a watcher over the fixture with a fake clock and emitter; the
    /// snapshot handle is returned for direct assertions.
    fn watcher(
        fixture: &WatchFixture,
        clock: FakeWatchClock,
    ) -> (
        SteamWatcher<FakeDiscovery, FakeWatchClock, FakeEmitter>,
        Arc<Mutex<LocalLibrarySnapshot>>,
        FakeEmitter,
    ) {
        let (watcher, snapshot, emitter, _discovery) = watcher_with_discovery(fixture, clock);
        (watcher, snapshot, emitter)
    }

    /// Like [`watcher`] but hands back the discovery, so a test can break and
    /// repair discovery mid-run through the shared failure flag.
    fn watcher_with_discovery(
        fixture: &WatchFixture,
        clock: FakeWatchClock,
    ) -> (
        SteamWatcher<FakeDiscovery, FakeWatchClock, FakeEmitter>,
        Arc<Mutex<LocalLibrarySnapshot>>,
        FakeEmitter,
        FakeDiscovery,
    ) {
        let snapshot = Arc::new(Mutex::new(LocalLibrarySnapshot::new(
            Vec::new(),
            Vec::new(),
        )));
        let emitter = FakeEmitter::new();
        let discovery = discovery(fixture);
        let watcher =
            SteamWatcher::new(discovery.clone(), snapshot.clone(), emitter.clone(), clock);
        (watcher, snapshot, emitter, discovery)
    }

    #[test]
    fn the_first_tick_establishes_the_baseline_without_scanning() {
        let fixture = WatchFixture::new();
        fixture.write_manifest(730);
        let (mut watcher, _snapshot, emitter) = watcher(&fixture, FakeWatchClock::at(1_000));

        assert!(!watcher.tick());
        assert_eq!(emitter.count(), 0, "startup must not trigger a scan");
    }

    #[test]
    fn rapid_changes_coalesce_into_a_single_scan_after_the_debounce() {
        let fixture = WatchFixture::new();
        let clock = FakeWatchClock::at(1_000);
        let (mut watcher, _snapshot, emitter) = watcher(&fixture, clock.clone());

        // Baseline at t=1000s.
        fixture.write_manifest(730);
        assert!(!watcher.tick());

        // Three rapid changes inside the debounce window.
        fixture.write_manifest(570);
        assert!(!watcher.tick(), "change within debounce must not scan yet");
        fixture.write_manifest(4000);
        assert!(!watcher.tick());
        fixture.remove_manifest(730);
        assert!(!watcher.tick());

        // The last change settled: after the debounce, exactly one scan runs
        // over the coalesced final state.
        clock.advance(WATCH_DEBOUNCE_MS / 1000 + 1);
        assert!(
            watcher.tick(),
            "settled change must trigger exactly one scan"
        );
        assert_eq!(emitter.count(), 1);
        assert_eq!(emitter.games_of(0).len(), 2, "final state after coalescing");

        // No further changes: no further scans.
        assert!(!watcher.tick());
        assert_eq!(emitter.count(), 1);
    }

    #[test]
    fn continuous_rapid_changes_coalesce_until_the_churn_stops() {
        let fixture = WatchFixture::new();
        let clock = FakeWatchClock::at(1_000);
        let (mut watcher, _snapshot, emitter) = watcher(&fixture, clock.clone());
        assert!(!watcher.tick()); // baseline

        // A change every second for 20 seconds: the debounce keeps being
        // reset, so no scan fires while the churn lasts.
        for app_id in 1u32..=20u32 {
            clock.advance(1);
            fixture.write_manifest(app_id);
            assert!(
                !watcher.tick(),
                "changes inside the debounce window must not scan"
            );
        }
        assert_eq!(emitter.count(), 0, "continuous churn must not scan at all");

        // The churn stops: after the debounce, exactly one scan coalesces it.
        clock.advance(WATCH_DEBOUNCE_MS / 1000 + 1);
        assert!(watcher.tick());
        assert_eq!(emitter.count(), 1);
        assert_eq!(emitter.games_of(0).len(), 20);

        assert!(!watcher.tick());
        assert_eq!(emitter.count(), 1);
    }

    #[test]
    fn the_minimum_interval_guard_blocks_scans_until_it_elapses() {
        let fixture = WatchFixture::new();
        let clock = FakeWatchClock::at(1_000);
        let (mut watcher, _snapshot, emitter) = watcher(&fixture, clock.clone());
        assert!(!watcher.tick()); // baseline

        // First burst: change at t=1001, settled and scanned at t=1003.
        fixture.write_manifest(730);
        clock.advance(1);
        assert!(!watcher.tick());
        clock.advance(2);
        assert!(watcher.tick(), "first settled change must scan");
        assert_eq!(emitter.count(), 1);

        // Second burst settles inside the minimum interval: the debounce is
        // elapsed but the guard blocks the scan until the interval passes.
        fixture.write_manifest(570);
        clock.advance(1); // t=1004: change observed
        assert!(!watcher.tick());
        clock.advance(2); // t=1006: debounce elapsed, only 3s since the scan
        assert!(
            !watcher.tick(),
            "the minimum interval guard must block a scan 3s after the previous one"
        );
        clock.advance(1); // t=1007: still only 4s since the scan
        assert!(
            !watcher.tick(),
            "the minimum interval guard must block a scan 4s after the previous one"
        );
        assert_eq!(emitter.count(), 1);

        // At t=1008 the interval is complete: exactly one scan runs.
        clock.advance(1);
        assert!(watcher.tick());
        assert_eq!(emitter.count(), 2);
        assert_eq!(emitter.games_of(1).len(), 2);

        // No further changes: no further scans.
        assert!(!watcher.tick());
        assert_eq!(emitter.count(), 2);
    }

    #[test]
    fn watches_only_the_known_sources_and_manifest_files() {
        let fixture = WatchFixture::new();
        let clock = FakeWatchClock::at(1_000);
        let (mut watcher, _snapshot, emitter) = watcher(&fixture, clock.clone());
        assert!(!watcher.tick()); // baseline

        // A manifest outside every known source must not trigger anything.
        fixture.write_unrelated_manifest(999);
        clock.advance(WATCH_DEBOUNCE_MS / 1000 + 1);
        assert!(!watcher.tick());
        assert_eq!(emitter.count(), 0);

        // A non-manifest file inside a known source must not trigger either.
        fixture.write_foreign_file("notes.txt", "not a manifest");
        clock.advance(WATCH_DEBOUNCE_MS / 1000 + 1);
        assert!(!watcher.tick());
        assert_eq!(emitter.count(), 0);

        // A manifest in a known source does trigger one scan. The change is
        // debounced from the tick that observes it, so the first tick after
        // the write establishes the change and the next settles it.
        fixture.write_manifest(730);
        assert!(!watcher.tick(), "change observed: debounce starts now");
        clock.advance(WATCH_DEBOUNCE_MS / 1000 + 1);
        assert!(watcher.tick());
        assert_eq!(emitter.count(), 1);
        assert_eq!(emitter.games_of(0), vec!["Game 730".to_string()]);
    }

    #[test]
    fn a_libraryfolders_change_triggers_a_rescan_of_the_declared_libraries() {
        let fixture = WatchFixture::new();
        let clock = FakeWatchClock::at(1_000);
        let (mut watcher, _snapshot, emitter) = watcher(&fixture, clock.clone());
        assert!(!watcher.tick()); // baseline

        // A new library folder is declared: the local library changed even
        // though no manifest moved, and the scanner re-runs the locator.
        fixture.write_libraryfolders(
            "\"libraryfolders\"\n{\n\t\"1\"\n\t{\n\t\t\"path\"\t\t\"/elsewhere\"\n\t}\n}\n",
        );
        assert!(!watcher.tick(), "libraryfolders change observed");
        clock.advance(WATCH_DEBOUNCE_MS / 1000 + 1);
        assert!(watcher.tick());
        assert_eq!(emitter.count(), 1);
    }

    #[test]
    fn a_failed_scan_keeps_the_last_usable_snapshot_and_recovers() {
        let fixture = WatchFixture::new();
        fixture.write_manifest(730);
        let clock = FakeWatchClock::at(1_000);
        let (mut watcher, snapshot, emitter, discovery) =
            watcher_with_discovery(&fixture, clock.clone());

        // Baseline + one successful change scan.
        assert!(!watcher.tick());
        fixture.write_manifest(570);
        assert!(!watcher.tick(), "change observed");
        clock.advance(WATCH_DEBOUNCE_MS / 1000 + 1);
        assert!(watcher.tick());
        assert_eq!(snapshot.lock().unwrap().games().len(), 2);
        assert_eq!(emitter.count(), 1);

        // The library becomes undiscoverable: the scan fails, the previous
        // snapshot survives, and no event is published. The scan attempt is
        // gated by the minimum interval since the scan at t=1003.
        discovery.fail_locate();
        clock.advance(1); // t=1004: the break is observed
        assert!(!watcher.tick(), "the break is observed");
        clock.advance(WATCH_MIN_INTERVAL_MS / 1000); // t=1009: interval complete
        assert!(
            watcher.tick(),
            "the break is observed and a scan is attempted"
        );
        assert_eq!(
            snapshot.lock().unwrap().games().len(),
            2,
            "the last usable snapshot must survive a failed scan"
        );
        assert_eq!(emitter.count(), 1, "no event for a failed scan");

        // The library is discoverable again: the watcher recovers and
        // refreshes from the still-present manifests.
        discovery.recover_locate();
        assert!(!watcher.tick(), "repair observed");
        clock.advance(WATCH_MIN_INTERVAL_MS / 1000); // t=1014: debounce + interval done
        assert!(watcher.tick());
        assert_eq!(snapshot.lock().unwrap().games().len(), 2);
        assert_eq!(emitter.count(), 2);
    }

    #[test]
    fn honors_a_configured_debounce_and_minimum_interval() {
        let fixture = WatchFixture::new();
        let clock = FakeWatchClock::at(1_000);
        let (watcher, _snapshot, emitter) = watcher(&fixture, clock.clone());
        let mut watcher = watcher.with_timing(
            Duration::from_secs(1),
            Duration::from_secs(1),
            Duration::from_secs(1),
        );

        assert!(!watcher.tick()); // baseline
        fixture.write_manifest(730);
        clock.advance(1);
        assert!(
            !watcher.tick(),
            "one second is below the configured debounce?"
        );
        clock.advance(1);
        assert!(watcher.tick(), "the configured debounce must be honored");
        assert_eq!(emitter.count(), 1);
    }

    #[test]
    fn fingerprints_include_size_and_mtime_so_rewrites_are_changes() {
        let fixture = WatchFixture::new();
        let clock = FakeWatchClock::at(1_000);
        let (mut watcher, _snapshot, emitter) = watcher(&fixture, clock.clone());
        assert!(!watcher.tick()); // baseline

        // Rewriting the same manifest changes its mtime and size is tracked.
        // The first tick observes the original file; the rewrite then changes
        // the fingerprint (mtime) without changing the identity set.
        fixture.write_manifest(730);
        assert!(!watcher.tick(), "original manifest observed");
        std::thread::sleep(Duration::from_millis(20));
        fixture.write_manifest(730);
        assert!(!watcher.tick(), "the rewrite itself is the change");
        clock.advance(WATCH_DEBOUNCE_MS / 1000 + 1);
        assert!(
            watcher.tick(),
            "a rewrite of the same manifest must be a change"
        );
        assert_eq!(emitter.count(), 1);
    }
}
