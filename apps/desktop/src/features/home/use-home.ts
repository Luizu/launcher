import { useCallback, useEffect, useMemo, useState } from "react";
import type { LocalLibrarySnapshot } from "@fuse-launcher/contracts";
import { mergeLibrary } from "../../lib/merge-library";
import type { GameLibraryClientLike } from "../game-library/game-library-client";
import { useGameActions, type GameActionsClientLike } from "../game-library/use-game-actions";
import { useGameLibrary } from "../game-library/use-game-library";
import { useLaunchHistory } from "../launch-history/use-launch-history";
import type { LaunchHistoryClientLike } from "../launch-history/launch-history-client";
import { useLocalLibrary } from "../local-library/use-local-library";
import type { LocalLibraryClientLike } from "../local-library/local-library-client";
import type { OpenUrl } from "../platform-connections/use-steam-connection";
import {
  gameKey,
  rankHomeGames,
  selectFeaturedGame,
} from "./select-featured-game";

/** Debounce between focusing a selector game and committing it to the hero. */
export const HERO_DEBOUNCE_MS = 150;

/** Merge fallback while the local snapshot is still loading or failed. */
const NO_SNAPSHOT: LocalLibrarySnapshot = { games: [], diagnostics: [] };

export interface UseHomeOptions {
  gameLibrary?: GameLibraryClientLike;
  localLibrary?: LocalLibraryClientLike;
  /** Native game actions (launch/install/status); defaults to TauriClient. */
  tauri?: GameActionsClientLike;
  /** The opener plugin binding for the `Verificar na Steam` action. */
  openUrl?: OpenUrl;
  /**
   * The desktop-local play history source; defaults to the Tauri client.
   * The history never crosses the HTTP layer: it only ranks the Home.
   */
  historyClient?: LaunchHistoryClientLike;
  /**
   * Explicit history overrides (used by tests and future UI); entries here
   * win over the persisted history for the same game key.
   */
  history?: Record<string, string>;
  /** Pinned entries seam (no pinning UI in this delivery). */
  pinned?: string[];
}

/**
 * Composition for the Home: reads the remote library and the local snapshot
 * through the existing hooks, merges them, selects the featured game, and
 * owns the focus → debounce → hero commitment so focusing a selector game
 * never launches anything. The committed selection only lives while its game
 * exists in the merged library; otherwise the computed featured (activity,
 * history, pinned, installed order) takes over.
 */
export function useHome({
  gameLibrary,
  localLibrary,
  tauri,
  openUrl,
  historyClient,
  history = {},
  pinned = [],
}: UseHomeOptions = {}) {
  const remote = useGameLibrary({ gameLibrary });
  const local = useLocalLibrary({ client: localLibrary });
  const launchHistory = useLaunchHistory({ client: historyClient });
  const actions = useGameActions({ tauri, openUrl });

  const [focusedKey, setFocusedKey] = useState<string | null>(null);
  const [committedKey, setCommittedKey] = useState<string | null>(null);

  const games = useMemo(
    () =>
      mergeLibrary(
        { connection: remote.connection, entries: remote.entries },
        local.snapshot ?? NO_SNAPSHOT,
      ),
    [remote.connection, remote.entries, local.snapshot],
  );

  // Explicit history wins over the persisted history for the same game key.
  const rankedHistory = useMemo(
    () => ({ ...launchHistory.history, ...history }),
    [launchHistory.history, history],
  );

  /** Every game in the shared Home priority order (see rankHomeGames). */
  const ranked = useMemo(
    () => rankHomeGames(games, { history: rankedHistory, pinned }),
    [games, rankedHistory, pinned],
  );

  const computedFeatured = useMemo(
    () =>
      // The selector fallback ranks every game, so a library with nothing
      // prioritized still gets a featured game — the Home never hides when
      // the library has games.
      selectFeaturedGame(games, { history: rankedHistory, pinned }) ??
      ranked[0] ??
      null,
    [games, rankedHistory, pinned, ranked],
  );

  useEffect(() => {
    if (focusedKey === null) return;
    const timer = setTimeout(() => setCommittedKey(focusedKey), HERO_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [focusedKey]);

  const featured = useMemo(() => {
    if (committedKey !== null) {
      const committed = games.find((game) => gameKey(game) === committedKey);
      if (committed !== undefined) return committed;
    }
    return computedFeatured;
  }, [committedKey, computedFeatured, games]);

  const installed = useMemo(
    () => games.filter((game) => game.installState === "installed"),
    [games],
  );

  /**
   * The floating selector's items: the installed games when any exist
   * (unchanged behavior), else the top prioritized library games — the
   * featured game itself included, capped at eight — so a machine with
   * nothing installed still browses its library from the Home, and
   * committing a focused tile to the hero never unmounts that tile (focus
   * never drops to the body).
   */
  const selectorGames = useMemo(() => {
    if (installed.length > 0) return installed;
    return ranked.slice(0, 8);
  }, [installed, ranked]);

  const isStale = remote.connection?.syncStatus === "failed";

  const refreshRemote = remote.refresh;
  const refreshLocal = local.refresh;
  const refresh = useCallback(() => {
    refreshRemote();
    refreshLocal();
  }, [refreshRemote, refreshLocal]);

  return {
    games,
    installed,
    installedCount: installed.length,
    /** The selector items: installed games, or the top prioritized library. */
    selectorGames,
    featured,
    /** The selector item currently focused (emphasized immediately). */
    focusedKey,
    /** Focuses a selector game; the hero commits after the debounce. */
    focusGame: setFocusedKey,
    connection: remote.connection,
    /** True when the last sync failed: entries are stale but present. */
    isStale,
    isLoading: remote.isLoading && !remote.data,
    remoteFailed: remote.isError,
    localFailed: local.isError,
    /** True while the local scan is pending: install states are untrustworthy. */
    scanPending: local.isLoading && !local.snapshot,
    actions,
    refresh,
  };
}
