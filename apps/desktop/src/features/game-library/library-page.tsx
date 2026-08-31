import { useCallback, useMemo, useState } from "react";
import type { LocalLibrarySnapshot } from "@fuse-launcher/contracts";
import { GameCard } from "../../components/game-card/game-card";
import { InlineStatus } from "../../components/status/inline-status";
import { LibraryState } from "../../components/status/library-state";
import { mergeLibrary } from "../../lib/merge-library";
import { providerLabel } from "../../lib/provider-label";
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

type LibraryTab = "all" | "installed" | string;

function libraryCountLabel(count: number): string {
  return count === 1 ? "1 jogo nos provedores conectados" : `${count} jogos nos provedores conectados`;
}

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
 * title in two providers stays distinct); the heading row exposes sorting and
 * a compact disclosure for search and filters (installed toggle, provider
 * select only with 2+ providers). Tabs filter the same merged list client-side.
 * Game actions flow through `useGameActions`, whose single inline error banner
 * renders with a retry action.
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
  const [activeTab, setActiveTab] = useState<LibraryTab>("all");

  const providers = useMemo(() => libraryProviders(games), [games]);
  // A provider selected earlier may disappear after a refresh; "all" keeps
  // the select and the list in agreement instead of a blank option.
  const effectiveProvider = providers.includes(provider) ? provider : "all";

  const visibleGames = useMemo(
    () =>
      sortGames(
        filterGames(games, {
          query,
          installedOnly: installedOnly || activeTab === "installed",
          provider:
            activeTab !== "all" && activeTab !== "installed"
              ? activeTab
              : effectiveProvider,
        }),
        sortKey,
      ),
    [games, query, installedOnly, activeTab, effectiveProvider, sortKey],
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

  const connectionNeedsAttention =
    connection !== null && connection.syncStatus !== "synced";
  const showConnectionCard =
    !remote.isError && (!libraryUsable || connectionNeedsAttention);
  const tabs: ReadonlyArray<{ value: LibraryTab; label: string }> = [
    { value: "all", label: "Todos" },
    { value: "installed", label: "Instalados" },
    ...providers.map((candidate) => ({
      value: candidate,
      label: providerLabel(candidate),
    })),
  ];

  return (
    <div
      data-library-screen
      className="h-full min-h-0 overflow-y-auto overscroll-contain bg-[#07101b] pb-[42px] pl-[50px] pr-[35px] pt-[124px] max-[800px]:px-6 max-[800px]:pt-[88px]"
    >
      <header className="mb-[25px] flex items-end justify-between gap-5">
        <div className="min-w-0">
          <h1 className="m-0 text-[33px] font-black leading-none tracking-[-0.08em] text-white">
            Biblioteca
          </h1>
          <p className="mt-2 text-xs text-[#8da1bb]">{libraryCountLabel(games.length)}</p>
        </div>
        {games.length > 0 && !showConnectionCard && (
          <LibraryControls
            query={query}
            onQueryChange={setQuery}
            installedOnly={installedOnly}
            onInstalledOnlyChange={(value) => {
              setInstalledOnly(value);
              setActiveTab("all");
            }}
            providers={providers}
            provider={effectiveProvider}
            onProviderChange={(value) => {
              setProvider(value);
              setActiveTab("all");
            }}
            sortKey={sortKey}
            onSortKeyChange={setSortKey}
            onSync={cardProps.onSync}
            resultCount={visibleGames.length}
          />
        )}
      </header>

      {!firstLoad && games.length > 0 && !showConnectionCard && (
        <nav
          aria-label="Filtros rápidos da biblioteca"
          role="tablist"
          className="mb-[22px] flex gap-[5px] border-b border-[rgba(177,207,241,0.16)]"
        >
          {tabs.map((tab) => (
            <button
              key={tab.value}
              type="button"
              role="tab"
              aria-selected={activeTab === tab.value}
              onClick={() => {
                setActiveTab(tab.value);
                if (tab.value === "all") {
                  setInstalledOnly(false);
                  setProvider("all");
                } else if (tab.value === "installed") {
                  setInstalledOnly(false);
                  setProvider("all");
                } else {
                  setInstalledOnly(false);
                  setProvider(tab.value);
                }
              }}
              className={`border-b-2 px-3 pb-3 text-[11px] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#8cf5d0] ${
                activeTab === tab.value
                  ? "border-[#8cf5d0] text-[#f2f6ff]"
                  : "border-transparent text-[#6f839c] hover:text-[#c8d3e4]"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </nav>
      )}

      {firstLoad ? (
        <LibraryState loading />
      ) : remote.isError || libraryUsable ? (
        <>
          {showConnectionCard && (
            <div className="mb-5 flex flex-col items-start">
              <SteamConnectionCard {...cardProps} />
            </div>
          )}
          <div className="flex flex-col gap-4">
            <LibraryState
              errors={errors}
              empty={errors.length === 0 && games.length === 0}
              onRefresh={refreshAll}
            />
            {actions.error !== null && (
              <InlineStatus tone="error" onRetry={actions.retry}>
                {actions.error}
              </InlineStatus>
            )}
          </div>
          {games.length > 0 && (
            <>
              {visibleGames.length === 0 ? (
                <div className="flex flex-col items-center gap-4 py-16 text-center">
                  <p className="text-sm text-[#c8d3e4]">
                    Nenhum jogo corresponde aos filtros.
                  </p>
                </div>
              ) : (
                <ul
                  aria-label="Jogos da biblioteca"
                  className="grid grid-cols-1 gap-x-3 gap-y-[17px] min-[560px]:grid-cols-2 min-[820px]:grid-cols-3 lg:grid-cols-5"
                >
                  {visibleGames.map((game) => (
                    <li
                      key={`${game.provider}:${game.externalGameId}`}
                      className="min-w-0"
                    >
                      <GameCard
                        appearance="library"
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
        <div className="flex min-h-[calc(100vh-220px)] flex-col items-center justify-center">
          <SteamConnectionCard {...cardProps} />
        </div>
      )}
    </div>
  );
}
