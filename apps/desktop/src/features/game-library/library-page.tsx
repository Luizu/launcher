import { useCallback, useMemo, useState } from "react";
import type { LocalLibrarySnapshot } from "@launcher/contracts";
import { GameCard } from "../../components/game-card/game-card";
import { InlineStatus } from "../../components/status/inline-status";
import { LibraryState } from "../../components/status/library-state";
import { mergeLibrary } from "../../lib/merge-library";
import type { LocalLibraryClientLike } from "../local-library/local-library-client";
import { useLocalLibrary } from "../local-library/use-local-library";
import type { PlatformConnectionsClientLike } from "../platform-connections/platform-connections-client";
import { SteamConnectionCard } from "../platform-connections/steam-connection-card";
import {
  useSteamConnection,
  type OpenUrl,
} from "../platform-connections/use-steam-connection";
import type { GameLibraryClientLike } from "./game-library-client";
import { LibraryControls } from "./library-controls";
import {
  filterGames,
  libraryProviders,
  sortGames,
  type LibrarySortKey,
} from "./library-filter";
import { useGameActions, type GameActionsClientLike } from "./use-game-actions";
import { useGameLibrary } from "./use-game-library";

/** Merge fallback while the local snapshot is still loading or failed. */
const NO_SNAPSHOT: LocalLibrarySnapshot = { games: [], diagnostics: [] };

const REMOTE_ERROR_MESSAGE = "Não foi possível carregar sua biblioteca da Steam.";
const LOCAL_ERROR_MESSAGE = "Não foi possível verificar seus jogos instalados.";

export interface LibraryPageProps {
  /** Opens the Steam authorization URL in the external browser. */
  openUrl: OpenUrl;
  platformConnections?: PlatformConnectionsClientLike;
  gameLibrary?: GameLibraryClientLike;
  localLibrary?: LocalLibraryClientLike;
  /** Native game actions (launch/install/status); defaults to TauriClient. */
  tauri?: GameActionsClientLike;
}

/**
 * The merged Steam library page. On mount it requests the remote library and
 * starts one local scan in parallel (both cached; the local snapshot is
 * `staleTime: Infinity` until the user presses `Atualizar`). The page owns
 * the states: loading skeleton, not connected / private / unavailable via the
 * connection card, empty with refresh, ready as a responsive card grid, and
 * partial errors that preserve the successful side with a retry for the
 * failed one. Games render one card per `provider:externalGameId` (the same
 * title in two providers stays distinct); the toolbar above the grid
 * searches, filters (installed toggle, provider select only with 2+
 * providers), and sorts the merged list client-side. Game actions flow
 * through `useGameActions`, whose single inline error banner renders with a
 * retry action.
 */
export function LibraryPage({
  openUrl,
  platformConnections,
  gameLibrary,
  localLibrary,
  tauri,
}: LibraryPageProps) {
  const remote = useGameLibrary({ gameLibrary });
  const local = useLocalLibrary({ client: localLibrary });
  const actions = useGameActions({ tauri, openUrl });
  const cardProps = useSteamConnection({
    client: platformConnections,
    gameLibrary,
    openUrl,
  });

  const refreshRemote = remote.refresh;
  const refreshLocal = local.refresh;

  const games = useMemo(
    () =>
      mergeLibrary(
        { connection: remote.connection, entries: remote.entries },
        local.snapshot ?? NO_SNAPSHOT,
      ),
    [remote.connection, remote.entries, local.snapshot],
  );

  // Search/filter/sort state: the toolbar owns the inputs, the page owns the
  // derived list so every combination composes in one place.
  const [query, setQuery] = useState("");
  const [installedOnly, setInstalledOnly] = useState(false);
  const [provider, setProvider] = useState("all");
  const [sortKey, setSortKey] = useState<LibrarySortKey>("default");

  const providers = useMemo(() => libraryProviders(games), [games]);
  // A provider selected earlier may disappear after a refresh; "all" keeps
  // the select and the list in agreement instead of a blank option.
  const effectiveProvider = providers.includes(provider) ? provider : "all";

  const visibleGames = useMemo(
    () =>
      sortGames(
        filterGames(games, {
          query,
          installedOnly,
          provider: effectiveProvider,
        }),
        sortKey,
      ),
    [games, query, installedOnly, effectiveProvider, sortKey],
  );

  const refreshAll = useCallback(() => {
    refreshRemote();
    refreshLocal();
  }, [refreshRemote, refreshLocal]);

  const errors = useMemo(() => {
    const list: { message: string; onRetry: () => void }[] = [];
    if (remote.isError) {
      list.push({ message: REMOTE_ERROR_MESSAGE, onRetry: remote.refresh });
    }
    if (local.isError) {
      list.push({ message: LOCAL_ERROR_MESSAGE, onRetry: local.refresh });
    }
    return list;
  }, [remote.isError, remote.refresh, local.isError, local.refresh]);

  const connection = remote.connection;
  // A failed sync keeps the last valid snapshot: the page stays usable so the
  // stale entries render alongside the connection card's failed state. Only
  // explicit private/unavailable visibility (or no connection) hides the list.
  const libraryUsable =
    connection !== null &&
    connection.visibility !== "private" &&
    connection.visibility !== "unavailable";

  const firstLoad = remote.isLoading && !remote.data;

  /**
   * The local scan is still in flight: merged install states are not
   * trustworthy yet (the remote list may have resolved first), so the game
   * cards show a neutral placeholder instead of a misleading "Instalar".
   */
  const scanPending = local.isLoading && !local.snapshot;

  return (
    <div className="flex flex-1 flex-col gap-6 overflow-y-auto p-6">
      <h1 className="text-2xl font-semibold tracking-tight">Biblioteca</h1>

      {firstLoad ? (
        <LibraryState loading />
      ) : remote.isError || libraryUsable ? (
        <>
          <header className="flex flex-col gap-4">
            {!remote.isError && <SteamConnectionCard {...cardProps} />}
            <LibraryState
              errors={errors}
              empty={errors.length === 0 && games.length === 0}
              onRefresh={refreshAll}
            />
          </header>
          {actions.error !== null && (
            <InlineStatus tone="error" onRetry={actions.retry}>
              {actions.error}
            </InlineStatus>
          )}
          {games.length > 0 && (
            <>
              <LibraryControls
                query={query}
                onQueryChange={setQuery}
                installedOnly={installedOnly}
                onInstalledOnlyChange={setInstalledOnly}
                providers={providers}
                provider={effectiveProvider}
                onProviderChange={setProvider}
                sortKey={sortKey}
                onSortKeyChange={setSortKey}
                resultCount={visibleGames.length}
              />
              {visibleGames.length === 0 ? (
                <div className="flex flex-col items-center gap-4 rounded-lg border border-zinc-800 bg-zinc-900/60 p-8 text-center">
                  <p className="text-sm text-zinc-300">
                    Nenhum jogo corresponde aos filtros.
                  </p>
                </div>
              ) : (
                <ul className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-3">
                  {visibleGames.map((game) => (
                    <li
                      key={`${game.provider}:${game.externalGameId}`}
                      className="min-w-0"
                    >
                      <GameCard
                        game={game}
                        scanPending={scanPending}
                        onLaunch={actions.launch}
                        onInstall={actions.install}
                        onCheckSteam={actions.openSteamDownloads}
                      />
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </>
      ) : (
        // Not connected, or explicitly private/unavailable: the connection
        // card is the whole story, including the connect / retry action.
        <div className="flex flex-1 flex-col items-center justify-center">
          <SteamConnectionCard {...cardProps} />
        </div>
      )}
    </div>
  );
}
