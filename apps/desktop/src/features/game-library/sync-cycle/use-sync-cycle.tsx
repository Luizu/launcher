import { useCallback, useEffect, useRef, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { PlatformId, SyncLibraryResult } from "@fuse-launcher/contracts";
import { ApiClient } from "../../../lib/api-client";
import { useSession } from "../../auth/use-session";
import { GAME_LIBRARY_QUERY_KEY } from "../../platform-connections/use-steam-connection";
import type { GameLibraryClientLike } from "../game-library-client";
import { GameLibraryClient } from "../game-library-client";
import {
  defaultSyncCoordinator,
  SyncCoordinator,
} from "./sync-coordinator";
import { isSyncStale, SYNC_INTERVAL_MS, SYNC_STALE_MS } from "./sync-policy";

export { SYNC_INTERVAL_MS, SYNC_STALE_MS } from "./sync-policy";

const defaultGameLibraryClient = new GameLibraryClient(new ApiClient());

export interface UseSyncCycleOptions {
  /** Library client; defaults to the real HTTP client (injectable in tests). */
  gameLibrary?: GameLibraryClientLike;
  /** Coordinator shared with the connection card's manual retry. */
  syncCoordinator?: SyncCoordinator;
  /** Staleness window for the focus/periodic policy. */
  staleMs?: number;
  /** Periodic re-evaluation cadence while the app is open. */
  intervalMs?: number;
}

/**
 * The desktop sync cycle. Keeps the library current while Fuse Launcher is
 * open:
 *
 * - on mount, once the session is settled and a connection is known to
 *   exist, it requests one sync (ref-guarded, so re-renders and later data
 *   changes never fire it again);
 * - on window focus it syncs only when the connection is stale per
 *   {@link isSyncStale} (never synced, older than `staleMs`, or failed);
 * - on a periodic cadence while the app is open it re-evaluates the same
 *   policy and syncs when stale;
 * - it never syncs while the connection reports a recent `syncing` (a live
 *   sync in progress); a `syncing` connection with no recent sync is stuck
 *   (a previous session died mid-sync) and recovers through the same policy.
 *
 * All triggers route through the shared {@link SyncCoordinator}, so open,
 * focus, periodic, and manual card retries can never double-fire for the
 * same provider: concurrent triggers coalesce onto one in-flight request.
 *
 * Closing the app destroys the WebView and unmounts this hook, which clears
 * the periodic timer and the focus listener — no OS agent, no background
 * service, no resident process exists by construction. The connection card
 * remains the observable state surface: syncing, synced + timestamp, failed
 * with retry, private, unavailable.
 */
export function useSyncCycle({
  gameLibrary = defaultGameLibraryClient,
  syncCoordinator = defaultSyncCoordinator,
  staleMs = SYNC_STALE_MS,
  intervalMs = SYNC_INTERVAL_MS,
}: UseSyncCycleOptions = {}): void {
  const queryClient = useQueryClient();
  const { session, isLoading: sessionLoading } = useSession();

  // Shares the library cache with the connection card and the library page
  // via the same query key: no second fetch, and a successful sync
  // invalidates the same key so every consumer observes the fresh state.
  const libraryQuery = useQuery({
    queryKey: GAME_LIBRARY_QUERY_KEY,
    queryFn: () => gameLibrary.list(),
  });

  const sessionReady = !sessionLoading && session !== null;

  const runSync = useCallback(
    (provider: PlatformId): Promise<SyncLibraryResult> =>
      syncCoordinator.sync(provider, async () => {
        const result = await gameLibrary.sync();
        // Invalidation lives with the request so it runs exactly once per
        // actual sync, even when several callers share the same promise.
        void queryClient.invalidateQueries({ queryKey: GAME_LIBRARY_QUERY_KEY });
        return result;
      }),
    [gameLibrary, queryClient, syncCoordinator],
  );

  // Open sync: exactly once per mount, at the first moment the session is
  // settled and a connection is known to exist (the library query resolved).
  // The `syncing` guard runs before the budget is consumed: a connection
  // persisted as `syncing` (a previous session died mid-sync) must stay
  // re-evaluable — the effect re-runs on data changes and fires the open
  // sync once the terminal status arrives.
  const openSyncDone = useRef(false);
  useEffect(() => {
    if (openSyncDone.current) return;
    if (sessionLoading || session === null) return;
    const current = libraryQuery.data?.connection ?? null;
    if (current === null) return;
    // A live sync in progress (recent syncing) stays blocked; a `syncing`
    // connection with no recent sync is stale (stuck) and the open sync
    // recovers it.
    if (current.syncStatus === "syncing" && !isSyncStale(current, staleMs, Date.now())) {
      return;
    }
    openSyncDone.current = true;
    void runSync(current.provider).catch(() => {
      // Cycle failures are never surfaced here: the connection state served
      // by the API (fetched on invalidation) is the observable surface, and
      // the card renders failed + retry from it.
    });
  }, [libraryQuery.data, runSync, session, sessionLoading, staleMs]);

  // Window focus: sync only when stale per the policy (a recent syncing
  // connection is not stale; a stuck one is). The listener re-subscribes when
  // the observed state changes (cheap; the policy still decides per event, so
  // re-renders never produce sync calls).
  useEffect(() => {
    if (!sessionReady) return;
    const handleFocus = () => {
      const current = libraryQuery.data?.connection ?? null;
      if (current === null) return;
      if (!isSyncStale(current, staleMs, Date.now())) return;
      void runSync(current.provider).catch(() => {});
    };
    window.addEventListener("focus", handleFocus);
    return () => {
      window.removeEventListener("focus", handleFocus);
    };
  }, [libraryQuery.data, runSync, sessionReady, staleMs]);

  // Periodic re-evaluation while the app is open, honoring the same policy.
  useEffect(() => {
    if (!sessionReady) return;
    const timer = setInterval(() => {
      const current = libraryQuery.data?.connection ?? null;
      if (current === null) return;
      if (!isSyncStale(current, staleMs, Date.now())) return;
      void runSync(current.provider).catch(() => {});
    }, intervalMs);
    return () => {
      clearInterval(timer);
    };
  }, [intervalMs, libraryQuery.data, runSync, sessionReady, staleMs]);
}

export interface SyncCycleProps extends UseSyncCycleOptions {
  children: ReactNode;
}

/**
 * Inert wrapper that runs the sync cycle for the authenticated shell area.
 * Mounted at the router level so the cycle lives for as long as the app is
 * open and unmounts with the shell (session end or app close).
 */
export function SyncCycle({ children, ...options }: SyncCycleProps) {
  useSyncCycle(options);
  return <>{children}</>;
}
