import { act, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type {
  GameLibraryResponse,
  LaunchHistory,
  LocalLibrarySnapshot,
} from "@launcher/contracts";
import { GAME_LIBRARY_QUERY_KEY } from "../platform-connections/use-steam-connection";
import { LOCAL_LIBRARY_QUERY_KEY } from "../local-library/use-local-library";
import { LAUNCH_HISTORY_QUERY_KEY } from "../launch-history/use-launch-history";
import type { GameLibraryClientLike } from "../game-library/game-library-client";
import type { GameActionsClientLike } from "../game-library/use-game-actions";
import type { LocalLibraryClientLike } from "../local-library/local-library-client";
import type { LaunchHistoryClientLike } from "../launch-history/launch-history-client";
import { gameKey } from "./select-featured-game";
import { useHome, HERO_DEBOUNCE_MS } from "./use-home";

const SYNCED_PUBLIC = {
  provider: "steam",
  visibility: "public",
  syncStatus: "synced",
  lastSyncedAt: "2026-08-28T00:00:00.000Z",
} as const;

const FAILED_PUBLIC = {
  provider: "steam",
  visibility: "public",
  syncStatus: "failed",
  lastSyncedAt: "2026-08-28T00:00:00.000Z",
} as const;

const REMOTE_CS2 = {
  provider: "steam",
  externalGameId: "730",
  name: "Counter-Strike 2",
  enrichmentStatus: "enriched",
  catalogIdentity: null,
  lastActivityAt: "2026-08-28T10:00:00.000Z",
} as const;

const LOCAL_CS2 = {
  provider: "steam",
  externalGameId: 730,
  name: "csgo",
  state: "installed",
} as const;

const LOCAL_GARRY = {
  provider: "steam",
  externalGameId: 4000,
  name: "Garry's Mod",
  state: "installed",
} as const;

const EMPTY_SNAPSHOT: LocalLibrarySnapshot = { games: [], diagnostics: [] };

const EMPTY_HISTORY: LaunchHistory = { entries: [] };

const HISTORY_4000: LaunchHistory = {
  entries: [
    {
      provider: "steam",
      externalGameId: 4000,
      lastLaunchedAt: "2026-08-29T14:07:39Z",
    },
  ],
};

const never = <T,>(): Promise<T> => new Promise<T>(() => undefined);

function gameLibraryClient(
  list: () => Promise<GameLibraryResponse>,
): GameLibraryClientLike {
  return { list, sync: vi.fn().mockResolvedValue({ status: "synced" }) };
}

function localLibraryClient(
  scan: () => Promise<LocalLibrarySnapshot>,
): LocalLibraryClientLike {
  return { scan };
}

function seed(
  queryClient: QueryClient,
  {
    connection = SYNCED_PUBLIC,
    entries = [],
    snapshot = EMPTY_SNAPSHOT,
    history = EMPTY_HISTORY,
    seedRemote = true,
    seedLocal = true,
    seedHistory = true,
  }: {
    connection?: typeof SYNCED_PUBLIC | typeof FAILED_PUBLIC;
    entries?: unknown[];
    snapshot?: LocalLibrarySnapshot;
    history?: LaunchHistory;
    /** False leaves the remote cache empty so the query runs its queryFn. */
    seedRemote?: boolean;
    /** False leaves the local cache empty so the query runs its queryFn. */
    seedLocal?: boolean;
    /** False leaves the history cache empty so the query runs its queryFn. */
    seedHistory?: boolean;
  } = {},
) {
  if (seedRemote) {
    queryClient.setQueryData(GAME_LIBRARY_QUERY_KEY, { connection, entries });
  }
  if (seedLocal) {
    queryClient.setQueryData(LOCAL_LIBRARY_QUERY_KEY, snapshot);
  }
  if (seedHistory) {
    queryClient.setQueryData(LAUNCH_HISTORY_QUERY_KEY, history);
  }
}

function tauriClient(
  overrides: Partial<GameActionsClientLike> = {},
): GameActionsClientLike {
  return {
    launch: vi.fn().mockResolvedValue({ accepted: true }),
    install: vi.fn().mockResolvedValue({ accepted: true }),
    getInstallStatus: vi.fn().mockResolvedValue({ state: "unknown" }),
    ...overrides,
  };
}

interface ProbeOptions {
  history?: Record<string, string>;
  historyClient?: LaunchHistoryClientLike;
  pinned?: string[];
  gameLibrary?: GameLibraryClientLike;
  localLibrary?: LocalLibraryClientLike;
  launch?: GameActionsClientLike["launch"];
}

/** Exposes the hook's observable outputs as plain text for assertions. */
function HomeProbe({
  history,
  historyClient,
  pinned,
  gameLibrary,
  localLibrary,
  launch,
}: ProbeOptions) {
  const home = useHome({
    gameLibrary,
    localLibrary,
    historyClient,
    tauri: tauriClient({ launch }),
    history,
    pinned,
  });

  return (
    <div>
      {home.featured === null ? (
        <p>sem-destaque</p>
      ) : (
        <h2>{home.featured.name}</h2>
      )}
      <p>instalados: {home.installedCount}</p>
      {home.isStale && <p>stale</p>}
      {home.scanPending && <p>scan-pending</p>}
      {home.isLoading && <p>loading</p>}
      {home.installed.map((game) => (
        <button
          key={gameKey(game)}
          type="button"
          onFocus={() => home.focusGame(gameKey(game))}
        >
          {game.name}
        </button>
      ))}
      {home.selectorGames.map((game) => (
        <p key={gameKey(game)}>seletor: {game.name}</p>
      ))}
    </div>
  );
}

interface RenderProbeOptions extends ProbeOptions {
  /** Cache seeds; defaults to an empty synced library. */
  seedOptions?: Parameters<typeof seed>[1];
}

function renderProbe({ seedOptions, ...probe }: RenderProbeOptions = {}) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  seed(queryClient, seedOptions);
  render(
    <QueryClientProvider client={queryClient}>
      <HomeProbe {...probe} />
    </QueryClientProvider>,
  );
  return queryClient;
}

describe("useHome", () => {
  it("exposes the featured game chosen from the merged library", () => {
    renderProbe({
      seedOptions: {
        entries: [REMOTE_CS2],
        snapshot: { games: [LOCAL_CS2], diagnostics: [] },
      },
    });

    expect(screen.getByRole("heading", { name: "Counter-Strike 2" })).toBeInTheDocument();
    expect(screen.getByText("instalados: 1")).toBeInTheDocument();
    expect(screen.queryByText("stale")).not.toBeInTheDocument();
  });

  it("exposes a stale note when the connection reports a failed sync, keeping entries", () => {
    renderProbe({
      seedOptions: {
        connection: FAILED_PUBLIC,
        entries: [REMOTE_CS2],
        snapshot: { games: [LOCAL_CS2], diagnostics: [] },
      },
    });

    expect(screen.getByText("stale")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Counter-Strike 2" })).toBeInTheDocument();
  });

  it("commits a focused selector game to the hero only after the debounce", () => {
    vi.useFakeTimers();
    try {
      renderProbe({
        seedOptions: {
          entries: [REMOTE_CS2],
          snapshot: { games: [LOCAL_CS2, LOCAL_GARRY], diagnostics: [] },
        },
      });

      expect(screen.getByRole("heading", { name: "Counter-Strike 2" })).toBeInTheDocument();

      act(() => screen.getByRole("button", { name: "Garry's Mod" }).focus());
      // The hero still shows the previous game before the debounce elapses.
      expect(screen.getByRole("heading", { name: "Counter-Strike 2" })).toBeInTheDocument();

      act(() => vi.advanceTimersByTime(HERO_DEBOUNCE_MS));

      expect(screen.getByRole("heading", { name: "Garry's Mod" })).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps only the last focused game when focus changes during the debounce", () => {
    vi.useFakeTimers();
    try {
      renderProbe({
        seedOptions: {
          entries: [REMOTE_CS2],
          snapshot: { games: [LOCAL_CS2, LOCAL_GARRY], diagnostics: [] },
        },
      });

      act(() => screen.getByRole("button", { name: "Garry's Mod" }).focus());
      act(() => vi.advanceTimersByTime(HERO_DEBOUNCE_MS - 50));
      act(() => screen.getByRole("button", { name: "Counter-Strike 2" }).focus());
      act(() => vi.advanceTimersByTime(50));

      expect(screen.getByRole("heading", { name: "Counter-Strike 2" })).toBeInTheDocument();
      expect(screen.queryByRole("heading", { name: "Garry's Mod" })).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("never launches when a selector game is focused", () => {
    vi.useFakeTimers();
    try {
      const launch = vi.fn().mockResolvedValue({ accepted: true });
      renderProbe({
        launch,
        seedOptions: {
          entries: [REMOTE_CS2],
          snapshot: { games: [LOCAL_CS2, LOCAL_GARRY], diagnostics: [] },
        },
      });

      act(() => screen.getByRole("button", { name: "Garry's Mod" }).focus());
      act(() => vi.advanceTimersByTime(HERO_DEBOUNCE_MS + 1000));

      expect(launch).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("falls back to the computed featured when the committed game leaves the library", () => {
    vi.useFakeTimers();
    try {
      const queryClient = renderProbe({
        seedOptions: {
          entries: [REMOTE_CS2],
          snapshot: { games: [LOCAL_CS2, LOCAL_GARRY], diagnostics: [] },
        },
      });

      act(() => screen.getByRole("button", { name: "Garry's Mod" }).focus());
      act(() => vi.advanceTimersByTime(HERO_DEBOUNCE_MS));
      expect(screen.getByRole("heading", { name: "Garry's Mod" })).toBeInTheDocument();

      // The local snapshot changes (game gone): the committed selection must
      // not stick to a game that no longer exists. The query notification is
      // scheduled on a timer, so it needs a flush under fake timers.
      act(() => {
        queryClient.setQueryData(LOCAL_LIBRARY_QUERY_KEY, {
          games: [LOCAL_CS2],
          diagnostics: [],
        });
        vi.advanceTimersByTime(0);
      });

      expect(screen.getByRole("heading", { name: "Counter-Strike 2" })).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("reports scan-pending while the local snapshot is missing", () => {
    renderProbe({
      localLibrary: localLibraryClient(never),
      seedOptions: { entries: [REMOTE_CS2], seedLocal: false },
    });

    expect(screen.getByText("scan-pending")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Counter-Strike 2" })).toBeInTheDocument();
  });

  it("reports loading during the first remote load", () => {
    renderProbe({
      gameLibrary: gameLibraryClient(never),
      seedOptions: { snapshot: { games: [LOCAL_CS2], diagnostics: [] }, seedRemote: false },
    });

    expect(screen.getByText("loading")).toBeInTheDocument();
  });

  it("ranks a locally launched game when the provider reports no activity", () => {
    const REMOTE_IDLE = {
      ...REMOTE_CS2,
      lastActivityAt: null,
    };
    renderProbe({
      seedOptions: {
        entries: [REMOTE_IDLE],
        snapshot: { games: [LOCAL_CS2, LOCAL_GARRY], diagnostics: [] },
        history: HISTORY_4000,
      },
    });

    expect(screen.getByRole("heading", { name: "Garry's Mod" })).toBeInTheDocument();
  });

  it("lets remote activity beat the local history in the Home rule", () => {
    renderProbe({
      seedOptions: {
        entries: [REMOTE_CS2],
        snapshot: { games: [LOCAL_CS2, LOCAL_GARRY], diagnostics: [] },
        history: HISTORY_4000,
      },
    });

    // CS2 carries remote activity at 2026-08-28T10:00:00Z; Garry's Mod only
    // has a local launch. The provider's word wins over the local history.
    expect(screen.getByRole("heading", { name: "Counter-Strike 2" })).toBeInTheDocument();
  });

  it("keeps the installed games as the selector items when anything is installed", () => {
    renderProbe({
      seedOptions: {
        entries: [REMOTE_CS2],
        snapshot: { games: [LOCAL_CS2, LOCAL_GARRY], diagnostics: [] },
      },
    });

    expect(screen.getByText("seletor: Counter-Strike 2")).toBeInTheDocument();
    expect(screen.getByText("seletor: Garry's Mod")).toBeInTheDocument();
    expect(screen.getByText("instalados: 2")).toBeInTheDocument();
  });

  it("falls back to the top prioritized library games when nothing is installed", () => {
    const REMOTE_GARRY = {
      ...REMOTE_CS2,
      externalGameId: "4000",
      name: "Garry's Mod",
      lastActivityAt: "2026-08-27T10:00:00.000Z",
    };
    renderProbe({
      seedOptions: {
        entries: [REMOTE_CS2, REMOTE_GARRY],
        snapshot: EMPTY_SNAPSHOT,
      },
    });

    // Featured is the most recent activity; the selector keeps it in the
    // row so committing a focused tile never unmounts it.
    expect(screen.getByRole("heading", { name: "Counter-Strike 2" })).toBeInTheDocument();
    expect(screen.getByText("seletor: Garry's Mod")).toBeInTheDocument();
    expect(screen.getByText("seletor: Counter-Strike 2")).toBeInTheDocument();
    expect(screen.getByText("instalados: 0")).toBeInTheDocument();
  });

  it("caps the fallback selector at eight games", () => {
    const entries = Array.from({ length: 10 }, (_, index) => ({
      ...REMOTE_CS2,
      externalGameId: String(1000 + index),
      name: `Game ${index + 1}`,
      lastActivityAt: null,
    }));
    renderProbe({
      seedOptions: {
        entries,
        snapshot: EMPTY_SNAPSHOT,
      },
    });

    // Nothing is prioritized: the featured game is the first by name
    // ("Game 1"), and the selector holds the top eight including it.
    expect(screen.getByRole("heading", { name: "Game 1" })).toBeInTheDocument();
    expect(screen.getAllByText(/^seletor: Game/)).toHaveLength(8);
    expect(screen.getByText("seletor: Game 1")).toBeInTheDocument();
  });
});
