import { act, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type {
  GameLibraryConnection,
  GameLibraryResponse,
  SessionResponse,
  SyncLibraryResult,
} from "@fuse-launcher/contracts";
import { AuthProvider, type AuthClientLike } from "../../auth/auth-context";
import { SteamConnectionCard } from "../../platform-connections/steam-connection-card";
import { useGameLibrary } from "../use-game-library";
import type { GameLibraryClientLike } from "../game-library-client";
import { SyncCoordinator } from "./sync-coordinator";
import {
  GAME_LIBRARY_QUERY_KEY,
  useSteamConnection,
} from "../../platform-connections/use-steam-connection";
import { SYNC_INTERVAL_MS, SYNC_STALE_MS, useSyncCycle } from "./use-sync-cycle";

const SESSION: SessionResponse = {
  user: {
    id: "user-1",
    email: "a@example.com",
    emailVerified: true,
    name: "Luizu",
    image: null,
  },
  session: {
    id: "session-1",
    token: "token",
    userId: "user-1",
    expiresAt: "2026-09-01T00:00:00.000Z",
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
  },
};

const NEVER_SYNCED: GameLibraryConnection = {
  provider: "steam",
  visibility: "public",
  syncStatus: "never",
  lastSyncedAt: null,
};

const FRESH_SYNCED: GameLibraryConnection = {
  provider: "steam",
  visibility: "public",
  syncStatus: "synced",
  lastSyncedAt: new Date().toISOString(),
};

const STALE_SYNCED: GameLibraryConnection = {
  provider: "steam",
  visibility: "public",
  syncStatus: "synced",
  lastSyncedAt: new Date(Date.now() - 20 * 60 * 1000).toISOString(),
};

const FAILED: GameLibraryConnection = {
  provider: "steam",
  visibility: "public",
  syncStatus: "failed",
  lastSyncedAt: new Date(Date.now() - 20 * 60 * 1000).toISOString(),
};

// A live sync in progress: recent last sync, so the cycle must leave it
// alone (open, focus, periodic).
const SYNCING: GameLibraryConnection = {
  provider: "steam",
  visibility: "unknown",
  syncStatus: "syncing",
  lastSyncedAt: new Date(Date.now() - 60 * 1000).toISOString(),
};

// A stuck sync: persisted as `syncing` (a previous session died mid-sync)
// with no sync recent enough — the cycle must recover it like any stale
// connection.
const STUCK_SYNCING: GameLibraryConnection = {
  provider: "steam",
  visibility: "unknown",
  syncStatus: "syncing",
  lastSyncedAt: new Date(Date.now() - 9 * 60 * 60 * 1000).toISOString(),
};

const CONNECTION_NULL: GameLibraryResponse = {
  connection: null,
  entries: [],
};

function responseWith(connection: GameLibraryConnection | null): GameLibraryResponse {
  return { connection, entries: [] };
}

function authClient(session: SessionResponse | null = SESSION): AuthClientLike {
  return {
    getSession: vi.fn().mockResolvedValue(session),
    signIn: vi.fn(),
    signUp: vi.fn(),
    signOut: vi.fn(),
  };
}

function gameLibraryClient(
  list: () => Promise<GameLibraryResponse>,
  sync?: () => Promise<SyncLibraryResult>,
): GameLibraryClientLike {
  return {
    list,
    sync: sync ?? vi.fn().mockResolvedValue({ status: "synced" }),
  };
}

interface CycleProbeProps {
  gameLibrary: GameLibraryClientLike;
  syncCoordinator: SyncCoordinator;
  intervalMs: number;
  staleMs: number;
  /** Forces a re-render of the probe without changing any behavior. */
  rerenderKey?: number;
}

function CycleProbe({ gameLibrary, syncCoordinator, intervalMs, staleMs, rerenderKey }: CycleProbeProps) {
  useSyncCycle({ gameLibrary, syncCoordinator, intervalMs, staleMs });
  return <span data-testid="rerender-key">{rerenderKey ?? 0}</span>;
}

interface RenderProbeOptions {
  response?: GameLibraryResponse;
  session?: SessionResponse | null;
  authClient?: AuthClientLike;
  syncCoordinator?: SyncCoordinator;
  intervalMs?: number;
  staleMs?: number;
  sync?: () => Promise<SyncLibraryResult>;
  /** Overrides the internal list stub (e.g. scripted responses per call). */
  list?: () => Promise<GameLibraryResponse>;
}

function renderProbe({
  response = responseWith(STALE_SYNCED),
  session = SESSION,
  authClient: auth = authClient(session),
  syncCoordinator = new SyncCoordinator(),
  intervalMs = SYNC_INTERVAL_MS,
  staleMs = SYNC_STALE_MS,
  sync,
  list: listOverride,
}: RenderProbeOptions = {}) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const list = listOverride ?? vi.fn().mockResolvedValue(response);
  const syncFn = sync ?? vi.fn().mockResolvedValue({ status: "synced" });

  const view = render(
    <QueryClientProvider client={queryClient}>
      <AuthProvider client={auth}>
        <CycleProbe
          gameLibrary={gameLibraryClient(list, syncFn)}
          syncCoordinator={syncCoordinator}
          intervalMs={intervalMs}
          staleMs={staleMs}
        />
      </AuthProvider>
    </QueryClientProvider>,
  );

  return { queryClient, list, sync: syncFn, syncCoordinator, ...view };
}

/** Probe that also renders the connection card off the shared library query. */
function CardCycleProbe({
  gameLibrary,
  syncCoordinator,
  intervalMs,
  staleMs,
}: Omit<CycleProbeProps, "rerenderKey">) {
  useSyncCycle({ gameLibrary, syncCoordinator, intervalMs, staleMs });
  const { connection } = useGameLibrary({ gameLibrary });
  return connection !== null ? (
    <SteamConnectionCard startLink={vi.fn()} openUrl={vi.fn()} connection={connection} />
  ) : null;
}

/** Probe that combines the cycle with the card's manual retry path. */
function CombinedProbe({
  gameLibrary,
  syncCoordinator,
  intervalMs,
  staleMs,
}: Omit<CycleProbeProps, "rerenderKey">) {
  useSyncCycle({ gameLibrary, syncCoordinator, intervalMs, staleMs });
  const cardProps = useSteamConnection({
    client: {
      startSteamLink: vi.fn().mockResolvedValue({
        attemptId: "attempt-1",
        authorizationUrl: "https://steamcommunity.com/openid/login",
      }),
      getSteamLinkStatus: vi.fn(),
    },
    gameLibrary,
    syncCoordinator,
    openUrl: vi.fn().mockResolvedValue(undefined),
  });
  return <SteamConnectionCard {...cardProps} />;
}

function renderCardProbe(options: RenderProbeOptions = {}) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const response = options.response ?? responseWith(STALE_SYNCED);
  const list = options.list ?? vi.fn().mockResolvedValue(response);
  const syncFn = options.sync ?? vi.fn().mockResolvedValue({ status: "synced" });
  const auth = options.authClient ?? authClient(options.session ?? SESSION);

  const view = render(
    <QueryClientProvider client={queryClient}>
      <AuthProvider client={auth}>
        <CardCycleProbe
          gameLibrary={gameLibraryClient(list, syncFn)}
          syncCoordinator={options.syncCoordinator ?? new SyncCoordinator()}
          intervalMs={options.intervalMs ?? SYNC_INTERVAL_MS}
          staleMs={options.staleMs ?? SYNC_STALE_MS}
        />
      </AuthProvider>
    </QueryClientProvider>,
  );

  return { queryClient, list, sync: syncFn, ...view };
}

function renderCombined(options: RenderProbeOptions = {}) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const response = options.response ?? responseWith(STALE_SYNCED);
  const list = options.list ?? vi.fn().mockResolvedValue(response);
  const syncFn = options.sync ?? vi.fn().mockResolvedValue({ status: "synced" });
  const auth = options.authClient ?? authClient(options.session ?? SESSION);

  const view = render(
    <QueryClientProvider client={queryClient}>
      <AuthProvider client={auth}>
        <CombinedProbe
          gameLibrary={gameLibraryClient(list, syncFn)}
          syncCoordinator={options.syncCoordinator ?? new SyncCoordinator()}
          intervalMs={options.intervalMs ?? SYNC_INTERVAL_MS}
          staleMs={options.staleMs ?? SYNC_STALE_MS}
        />
      </AuthProvider>
    </QueryClientProvider>,
  );

  return { queryClient, list, sync: syncFn, ...view };
}

describe("useSyncCycle — open", () => {
  it("requests exactly one sync on open when a connection exists, not per render", async () => {
    let resolveSync!: (result: SyncLibraryResult) => void;
    const sync = vi.fn(
      () =>
        new Promise<SyncLibraryResult>((resolve) => {
          resolveSync = resolve;
        }),
    );
    const { queryClient, sync: syncFn, rerender } = renderProbe({
      response: responseWith(NEVER_SYNCED),
      sync,
    });

    await act(async () => {});
    await act(async () => {});
    expect(syncFn).toHaveBeenCalledTimes(1);

    rerender(
      <QueryClientProvider client={queryClient}>
        <AuthProvider client={authClient()}>
          <CycleProbe
            gameLibrary={gameLibraryClient(
              vi.fn().mockResolvedValue(responseWith(NEVER_SYNCED)),
              sync,
            )}
            syncCoordinator={new SyncCoordinator()}
            intervalMs={SYNC_INTERVAL_MS}
            staleMs={SYNC_STALE_MS}
            rerenderKey={1}
          />
        </AuthProvider>
      </QueryClientProvider>,
    );
    await act(async () => {});
    expect(syncFn).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveSync({ status: "synced" });
    });
  });
});

describe("useSyncCycle — no connection / no session", () => {
  it("never syncs when no connection exists (open, focus, periodic)", async () => {
    vi.useFakeTimers();
    try {
      const { sync: syncFn } = renderProbe({
        response: CONNECTION_NULL,
        intervalMs: 60_000,
      });
      await act(async () => {});
      await act(async () => {});
      expect(syncFn).not.toHaveBeenCalled();

      fireEvent(window, new Event("focus"));
      await act(async () => {});
      expect(syncFn).not.toHaveBeenCalled();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(5 * 60_000);
      });
      expect(syncFn).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not sync while the session is loading or unavailable", async () => {
    let resolveSession!: (session: SessionResponse | null) => void;
    const auth: AuthClientLike = {
      getSession: vi.fn(
        () =>
          new Promise<SessionResponse | null>((resolve) => {
            resolveSession = resolve;
          }),
      ),
      signIn: vi.fn(),
      signUp: vi.fn(),
      signOut: vi.fn(),
    };
    const { sync: syncFn } = renderProbe({
      response: responseWith(STALE_SYNCED),
      authClient: auth,
    });

    await act(async () => {});
    expect(syncFn).not.toHaveBeenCalled();

    await act(async () => {
      resolveSession(null);
    });
    await act(async () => {});
    expect(syncFn).not.toHaveBeenCalled();

    fireEvent(window, new Event("focus"));
    await act(async () => {});
    expect(syncFn).not.toHaveBeenCalled();
  });

  it("fires the open sync once the session settles", async () => {
    let resolveSession!: (session: SessionResponse | null) => void;
    const auth: AuthClientLike = {
      getSession: vi.fn(
        () =>
          new Promise<SessionResponse | null>((resolve) => {
            resolveSession = resolve;
          }),
      ),
      signIn: vi.fn(),
      signUp: vi.fn(),
      signOut: vi.fn(),
    };
    const { sync: syncFn } = renderProbe({
      response: responseWith(STALE_SYNCED),
      authClient: auth,
    });

    await act(async () => {});
    expect(syncFn).not.toHaveBeenCalled();

    await act(async () => {
      resolveSession(SESSION);
    });
    await act(async () => {});
    expect(syncFn).toHaveBeenCalledTimes(1);
  });
});

describe("useSyncCycle — focus", () => {
  it("does not sync on focus while the connection is fresh", async () => {
    const { sync: syncFn } = renderProbe({
      response: responseWith(FRESH_SYNCED),
    });
    await act(async () => {});
    await act(async () => {});
    expect(syncFn).toHaveBeenCalledTimes(1); // open sync only

    fireEvent(window, new Event("focus"));
    await act(async () => {});
    expect(syncFn).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["stale", STALE_SYNCED],
    ["failed", FAILED],
    ["never synced", NEVER_SYNCED],
  ] as const)("syncs on focus when the connection is %s", async (_label, connection) => {
    const { sync: syncFn } = renderProbe({ response: responseWith(connection) });
    await act(async () => {});
    await act(async () => {});
    expect(syncFn).toHaveBeenCalledTimes(1); // open sync

    fireEvent(window, new Event("focus"));
    await act(async () => {});
    expect(syncFn).toHaveBeenCalledTimes(2);
  });

  it("never syncs while the connection reports recent syncing (open, focus, periodic)", async () => {
    vi.useFakeTimers();
    try {
      const { sync: syncFn } = renderProbe({
        response: responseWith(SYNCING),
        intervalMs: 60_000,
      });
      await act(async () => {});
      await act(async () => {});
      expect(syncFn).not.toHaveBeenCalled();

      fireEvent(window, new Event("focus"));
      await act(async () => {});
      expect(syncFn).not.toHaveBeenCalled();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(60_000);
      });
      expect(syncFn).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("fires the open sync for a stuck syncing connection (no recent sync)", async () => {
    const { sync: syncFn } = renderProbe({
      response: responseWith(STUCK_SYNCING),
    });
    await act(async () => {});
    await act(async () => {});
    expect(syncFn).toHaveBeenCalledTimes(1);
  });

  it("syncs on focus for a stuck syncing connection", async () => {
    const { sync: syncFn } = renderProbe({
      response: responseWith(STUCK_SYNCING),
    });
    await act(async () => {});
    await act(async () => {});
    expect(syncFn).toHaveBeenCalledTimes(1); // open sync

    fireEvent(window, new Event("focus"));
    await act(async () => {});
    expect(syncFn).toHaveBeenCalledTimes(2);
  });

  it("syncs on the periodic cadence for a stuck syncing connection", async () => {
    vi.useFakeTimers();
    try {
      const { sync: syncFn } = renderProbe({
        response: responseWith(STUCK_SYNCING),
        intervalMs: 60_000,
      });
      await act(async () => {});
      await act(async () => {});
      expect(syncFn).toHaveBeenCalledTimes(1); // open sync

      await act(async () => {
        await vi.advanceTimersByTimeAsync(60_000);
      });
      expect(syncFn).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("defers the open sync while the connection reports syncing and fires it once the status clears", async () => {
    // A connection persisted as `syncing` (previous session died mid-sync)
    // must not consume the open-sync budget: once the library data shows the
    // terminal state (any refetch — focus, staleness, manual refresh), the
    // cycle fires the open sync exactly once.
    const list = vi
      .fn()
      .mockResolvedValueOnce(responseWith(SYNCING))
      .mockResolvedValue(responseWith(FAILED));
    const { queryClient, list: listFn, sync: syncFn } = renderProbe({ list });

    await act(async () => {});
    await act(async () => {});
    expect(syncFn).not.toHaveBeenCalled();

    await act(async () => {
      await queryClient.invalidateQueries({ queryKey: GAME_LIBRARY_QUERY_KEY });
      // The observer notification is scheduled on a macrotask
      // (notifyManager's setTimeout(0) scheduler), so flush it inside act.
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await act(async () => {});
    // 1 = initial fetch, 2 = the refetch that showed the new status,
    // 3 = the cycle's own invalidation after the open sync resolved.
    expect(listFn).toHaveBeenCalledTimes(3);
    expect(syncFn).toHaveBeenCalledTimes(1);
  });
});

describe("useSyncCycle — periodic", () => {
  it("syncs on the periodic cadence while open and stops after unmount", async () => {
    vi.useFakeTimers();
    try {
      const { sync: syncFn, unmount } = renderProbe({
        response: responseWith(STALE_SYNCED),
        intervalMs: 60_000,
      });
      await act(async () => {});
      await act(async () => {});
      expect(syncFn).toHaveBeenCalledTimes(1); // open sync

      await act(async () => {
        await vi.advanceTimersByTimeAsync(60_000);
      });
      expect(syncFn).toHaveBeenCalledTimes(2);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(60_000);
      });
      expect(syncFn).toHaveBeenCalledTimes(3);

      unmount();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(30 * 60_000);
      });
      expect(syncFn).toHaveBeenCalledTimes(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not sync periodically while the connection is fresh", async () => {
    vi.useFakeTimers();
    try {
      // The fake clock advances with the timers, so the connection must stay
      // inside the staleness window for the whole advance (10 fake minutes).
      const freshNow = new Date(Date.now()).toISOString();
      const { sync: syncFn } = renderProbe({
        response: responseWith({
          ...FRESH_SYNCED,
          lastSyncedAt: freshNow,
        }),
        intervalMs: 60_000,
      });
      await act(async () => {});
      await act(async () => {});
      expect(syncFn).toHaveBeenCalledTimes(1); // open sync only

      await act(async () => {
        await vi.advanceTimersByTimeAsync(10 * 60_000);
      });
      expect(syncFn).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("useSyncCycle — concurrency and manual retry", () => {
  it("coalesces concurrent focus, periodic and manual triggers into one sync", async () => {
    vi.useFakeTimers();
    try {
      let resolveSync!: (result: SyncLibraryResult) => void;
      const sync = vi.fn(
        () =>
          new Promise<SyncLibraryResult>((resolve) => {
            resolveSync = resolve;
          }),
      );
      const coordinator = new SyncCoordinator();
      const { sync: syncFn, list } = renderCombined({
        response: responseWith(FAILED),
        syncCoordinator: coordinator,
        intervalMs: 60_000,
        sync,
      });

      await act(async () => {});
      await act(async () => {});
      expect(syncFn).toHaveBeenCalledTimes(1); // open sync is in flight

      // Focus, periodic tick, and a manual card retry land while it runs.
      fireEvent(window, new Event("focus"));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(60_000);
      });
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Tentar novamente" }));
      });

      expect(syncFn).toHaveBeenCalledTimes(1);
      expect(coordinator.isInFlight("steam")).toBe(true);

      await act(async () => {
        resolveSync({ status: "synced" });
      });
      await act(async () => {});

      // The shared promise settled: the record is cleared and the library
      // refetched through the invalidation.
      expect(coordinator.isInFlight("steam")).toBe(false);
      expect(list).toHaveBeenCalledTimes(2);

      // A later focus starts a fresh sync instead of reusing the old one.
      fireEvent(window, new Event("focus"));
      await act(async () => {});
      expect(syncFn).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("routes a manual retry through the coordinator and reflects the fresh result", async () => {
    const list = vi
      .fn()
      .mockResolvedValueOnce(responseWith(FAILED))
      .mockResolvedValue(responseWith(FRESH_SYNCED));
    const coordinator = new SyncCoordinator();
    const { sync: syncFn } = renderCombined({
      response: responseWith(FAILED),
      list,
      syncCoordinator: coordinator,
    });

    await act(async () => {});
    await act(async () => {});

    // Open sync resolved and the refetch showed the fresh connection.
    expect(await screen.findByText("Sincronizada")).toBeInTheDocument();
    expect(syncFn).toHaveBeenCalledTimes(1);
    expect(coordinator.isInFlight("steam")).toBe(false);

    // Manual retry ("Atualizar biblioteca") runs a second sync through the
    // same coordinator and the invalidation reflects the result again.
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Atualizar biblioteca" }));
    });
    expect(syncFn).toHaveBeenCalledTimes(2);
    expect(screen.getByText("Sincronizada")).toBeInTheDocument();
    expect(list).toHaveBeenCalledTimes(3);
  });

  it("keeps the retry available when a coordinator-routed sync fails", async () => {
    const coordinator = new SyncCoordinator();
    const sync = vi
      .fn()
      .mockResolvedValueOnce({ status: "synced" }) // open sync succeeds
      .mockRejectedValueOnce(new Error("provider down")) // manual retry fails
      .mockResolvedValue({ status: "synced" }); // next retry recovers
    const { sync: syncFn } = renderCombined({
      response: responseWith(FAILED),
      syncCoordinator: coordinator,
      sync,
    });

    await act(async () => {});
    await act(async () => {});
    expect(syncFn).toHaveBeenCalledTimes(1); // open sync succeeded

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Tentar novamente" }));
    });
    await act(async () => {});

    expect(syncFn).toHaveBeenCalledTimes(2);
    expect(
      screen.getByText("Não foi possível sincronizar a biblioteca."),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Tentar novamente" })).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Tentar novamente" }));
    });
    await act(async () => {});
    expect(syncFn).toHaveBeenCalledTimes(3);
    expect(
      screen.queryByText("Não foi possível sincronizar a biblioteca."),
    ).not.toBeInTheDocument();
    expect(coordinator.isInFlight("steam")).toBe(false);
  });
});

describe("useSyncCycle — enrichment independence", () => {
  it("ignores per-game enrichment status in the sync policy and the card display", async () => {
    const connection = FAILED;
    const response: GameLibraryResponse = {
      connection,
      entries: [
        {
          provider: "steam",
          externalGameId: "730",
          name: "Counter-Strike 2",
          enrichmentStatus: "failed",
          catalogIdentity: null,
        },
        {
          provider: "steam",
          externalGameId: "4000",
          name: "Garry's Mod",
          enrichmentStatus: "pending",
          catalogIdentity: null,
        },
      ],
    };
    const { sync: syncFn, list } = renderCardProbe({ response });

    await act(async () => {});
    await act(async () => {});

    // The card shows exactly the failed connection state, with no hint of
    // the per-game enrichment statuses.
    expect(
      screen.getByText("Não foi possível atualizar sua biblioteca."),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Tentar novamente" }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/enriquecimento|IGDB|catálogo/i)).not.toBeInTheDocument();

    // The policy still treats the failed connection as stale: the open sync
    // ran (with its invalidation refetch), and focus triggers another.
    expect(syncFn).toHaveBeenCalledTimes(1);
    expect(list).toHaveBeenCalledTimes(2); // initial + open sync's invalidation

    fireEvent(window, new Event("focus"));
    await act(async () => {});
    expect(syncFn).toHaveBeenCalledTimes(2);
    expect(list).toHaveBeenCalledTimes(3); // focus sync's invalidation refetch

    // Both consumers (cycle + card probe) share one library query: the only
    // fetches are the initial one and the invalidation refetches above.
  });
});
