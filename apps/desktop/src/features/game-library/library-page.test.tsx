import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import type {
  GameLibraryResponse,
  LocalLibrarySnapshot,
} from "@launcher/contracts";
import type { GameLibraryClientLike } from "./game-library-client";
import { LibraryPage } from "./library-page";
import type { LocalLibraryClientLike } from "../local-library/local-library-client";
import type { GameActionsClientLike } from "./use-game-actions";

const SYNCED_PUBLIC = {
  provider: "steam",
  visibility: "public",
  syncStatus: "synced",
  lastSyncedAt: "2026-08-28T00:00:00.000Z",
} as const;

const REMOTE_CS2 = {
  provider: "steam",
  externalGameId: "730",
  name: "Counter-Strike 2",
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

interface RenderPageOptions {
  list?: () => Promise<GameLibraryResponse>;
  scan?: () => Promise<LocalLibrarySnapshot>;
  openUrl?: (url: string) => Promise<void>;
  tauri?: GameActionsClientLike;
}

function renderPage({ list, scan, openUrl, tauri }: RenderPageOptions = {}) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const listFn =
    list ??
    vi.fn().mockResolvedValue({ connection: SYNCED_PUBLIC, entries: [] });
  const scanFn = scan ?? vi.fn().mockResolvedValue(EMPTY_SNAPSHOT);
  const openUrlFn = openUrl ?? vi.fn().mockResolvedValue(undefined);

  render(
    <QueryClientProvider client={queryClient}>
      {/* Card titles link to the game page, so the page needs a router. */}
      <MemoryRouter>
        <LibraryPage
          openUrl={openUrlFn}
          tauri={tauri}
          platformConnections={{
            startSteamLink: vi.fn().mockResolvedValue({
              attemptId: "attempt-1",
              authorizationUrl: "https://steamcommunity.com/openid/login",
            }),
            getSteamLinkStatus: vi.fn(),
          }}
          gameLibrary={gameLibraryClient(listFn)}
          localLibrary={localLibraryClient(scanFn)}
        />
      </MemoryRouter>
    </QueryClientProvider>,
  );

  return { list: listFn, scan: scanFn, openUrl: openUrlFn };
}

it("shows a skeleton while the library loads", () => {
  renderPage({
    list: vi.fn().mockReturnValue(new Promise<GameLibraryResponse>(() => {})),
  });

  expect(
    screen.getByRole("status", { name: "Carregando sua biblioteca" }),
  ).toBeInTheDocument();
});

it("shows the connect action when Steam is not connected", async () => {
  renderPage({ list: vi.fn().mockResolvedValue({ connection: null, entries: [] }) });

  expect(await screen.findByText("Steam não conectada")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Conectar Steam" })).toBeInTheDocument();
});

it("explains a private profile without listing games", async () => {
  renderPage({
    list: vi.fn().mockResolvedValue({
      connection: {
        provider: "steam",
        visibility: "private",
        syncStatus: "synced",
        lastSyncedAt: null,
      },
      entries: [REMOTE_CS2],
    }),
  });

  expect(
    await screen.findByText("Conta conectada; biblioteca indisponível"),
  ).toBeInTheDocument();
  expect(screen.queryByText("Counter-Strike 2")).not.toBeInTheDocument();
});

it("shows the empty state with a refresh action", async () => {
  renderPage();

  expect(await screen.findByText("Nenhum jogo encontrado")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Atualizar" })).toBeInTheDocument();
});

it("keeps stale remote entries visible next to the failed connection state", async () => {
  renderPage({
    list: vi.fn().mockResolvedValue({
      connection: {
        provider: "steam",
        visibility: "public",
        syncStatus: "failed",
        lastSyncedAt: "2026-08-28T00:00:00.000Z",
      },
      entries: [REMOTE_CS2],
    }),
  });

  // The connection card keeps communicating the failed state with a distinct
  // failure message, the last-sync time (so the list is visibly not current)
  // and a retry…
  expect(
    await screen.findByText("Não foi possível atualizar sua biblioteca."),
  ).toBeInTheDocument();
  expect(screen.getByText(/Última sincronização/)).toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: "Tentar novamente" }),
  ).toBeInTheDocument();
  expect(
    screen.queryByText("Sua biblioteca Steam está indisponível."),
  ).not.toBeInTheDocument();
  // …while the last valid snapshot stays visible as stale entries.
  expect(screen.getByText("Counter-Strike 2")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Instalar" })).toBeInTheDocument();
});

it("lists a remote game with the install action", async () => {
  renderPage({
    list: vi.fn().mockResolvedValue({
      connection: SYNCED_PUBLIC,
      entries: [REMOTE_CS2],
    }),
  });

  expect(await screen.findByText("Counter-Strike 2")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Instalar" })).toBeInTheDocument();
});

it("marks a locally installed game as launchable", async () => {
  renderPage({
    list: vi.fn().mockResolvedValue({
      connection: SYNCED_PUBLIC,
      entries: [REMOTE_CS2],
    }),
    scan: vi.fn().mockResolvedValue({ games: [LOCAL_CS2], diagnostics: [] }),
  });

  expect(await screen.findByText("Counter-Strike 2")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Jogar" })).toBeInTheDocument();
  expect(screen.queryByText("csgo")).not.toBeInTheDocument();
});

it("keeps local games and offers a retry when the remote library fails", async () => {
  renderPage({
    list: vi.fn().mockRejectedValue(new Error("network")),
    scan: vi.fn().mockResolvedValue({ games: [LOCAL_GARRY], diagnostics: [] }),
  });

  expect(
    await screen.findByText("Não foi possível carregar sua biblioteca da Steam."),
  ).toBeInTheDocument();
  expect(screen.getByText("Garry's Mod")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Jogar" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Tentar novamente" })).toBeInTheDocument();
});

it("does not flash a misleading install action while the local scan is pending", async () => {
  let resolveScan!: (value: LocalLibrarySnapshot) => void;
  const scan = vi.fn(
    () =>
      new Promise<LocalLibrarySnapshot>((resolve) => {
        resolveScan = resolve;
      }),
  );
  renderPage({
    list: vi.fn().mockResolvedValue({
      connection: SYNCED_PUBLIC,
      entries: [REMOTE_CS2],
    }),
    scan,
  });

  // The remote list renders as soon as it lands, but the install-state area
  // stays neutral until the local scan reports the real state.
  expect(await screen.findByText("Counter-Strike 2")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Verificando…" })).toBeDisabled();
  expect(screen.queryByRole("button", { name: "Instalar" })).not.toBeInTheDocument();

  await act(async () => {
    resolveScan({ games: [LOCAL_CS2], diagnostics: [] });
  });

  expect(await screen.findByRole("button", { name: "Jogar" })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Verificando…" })).not.toBeInTheDocument();
});

it("keeps remote games when the local scan fails", async () => {
  renderPage({
    list: vi.fn().mockResolvedValue({
      connection: SYNCED_PUBLIC,
      entries: [REMOTE_CS2],
    }),
    scan: vi.fn().mockRejectedValue(new Error("steam-not-installed")),
  });

  // The scan query retries once (retry: 1), so the error banner appears
  // after the boot retry's delay (~1s), past the default waitFor timeout.
  expect(
    await screen.findByText(
      "Não foi possível verificar seus jogos instalados.",
      {},
      { timeout: 3_000 },
    ),
  ).toBeInTheDocument();
  expect(screen.getByText("Counter-Strike 2")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Instalar" })).toBeInTheDocument();
});

it("retries the failed remote side from the error banner", async () => {
  const list = vi
    .fn()
    .mockRejectedValueOnce(new Error("network"))
    .mockResolvedValue({ connection: SYNCED_PUBLIC, entries: [REMOTE_CS2] });
  const user = userEvent.setup();
  renderPage({ list });

  await screen.findByText("Não foi possível carregar sua biblioteca da Steam.");
  await user.click(screen.getByRole("button", { name: "Tentar novamente" }));

  expect(await screen.findByText("Counter-Strike 2")).toBeInTheDocument();
  expect(list).toHaveBeenCalledTimes(2);
});

it("does not show raw app ids as primary copy", async () => {
  renderPage({
    list: vi.fn().mockResolvedValue({
      connection: SYNCED_PUBLIC,
      entries: [REMOTE_CS2],
    }),
  });

  await screen.findByText("Counter-Strike 2");
  expect(screen.queryByText("730")).not.toBeInTheDocument();
});

it("opens the Steam downloads page when a game state is unknown", async () => {
  const openUrl = vi.fn().mockResolvedValue(undefined);
  const user = userEvent.setup();
  renderPage({
    list: vi.fn().mockResolvedValue({
      connection: SYNCED_PUBLIC,
      entries: [REMOTE_CS2],
    }),
    scan: vi.fn().mockResolvedValue({
      games: [{ ...LOCAL_CS2, state: "unknown" }],
      diagnostics: [],
    }),
    openUrl,
  });

  await user.click(
    await screen.findByRole("button", { name: "Verificar na Steam" }),
  );

  expect(openUrl).toHaveBeenCalledWith("steam://open/downloads");
});

it("launches an installed game through the native client", async () => {
  const launch = vi.fn().mockResolvedValue({ accepted: true });
  const user = userEvent.setup();
  renderPage({
    list: vi.fn().mockResolvedValue({
      connection: SYNCED_PUBLIC,
      entries: [REMOTE_CS2],
    }),
    scan: vi.fn().mockResolvedValue({ games: [LOCAL_CS2], diagnostics: [] }),
    tauri: {
      launch,
      install: vi.fn(),
      getInstallStatus: vi.fn(),
    },
  });

  await user.click(await screen.findByRole("button", { name: "Jogar" }));

  await waitFor(() => expect(launch).toHaveBeenCalledWith(730));
});

describe("grid, search, filters, sorting, and keyboard", () => {
  /** Ordered displayed titles of the rendered cards (h3 of each article). */
  function cardTitles(): string[] {
    return screen
      .getAllByRole("article")
      .map(
        (article) =>
          within(article).getByRole("heading", { level: 3 }).textContent ?? "",
      );
  }

  /** Builds `count` remote entries named "Jogo 001".."Jogo NNN". */
  function makeEntries(count: number) {
    return Array.from({ length: count }, (_, index) => ({
      provider: "steam",
      externalGameId: String(1000 + index),
      name: `Jogo ${String(index + 1).padStart(3, "0")}`,
      playtimeMinutes: index * 10,
      lastActivityAt:
        index % 4 === 0
          ? new Date(Date.UTC(2026, 0, 1, 0, index)).toISOString()
          : undefined,
    }));
  }

  it("explains an unavailable profile without listing games", async () => {
    renderPage({
      list: vi.fn().mockResolvedValue({
        connection: {
          provider: "steam",
          visibility: "unavailable",
          syncStatus: "failed",
          lastSyncedAt: null,
        },
        entries: [REMOTE_CS2],
      }),
    });

    expect(
      await screen.findByText("Sua biblioteca Steam está indisponível."),
    ).toBeInTheDocument();
    expect(screen.queryByText("Counter-Strike 2")).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Tentar novamente" }),
    ).toBeInTheDocument();
  });

  it("renders a responsive grid with one card per game for 120 games", async () => {
    renderPage({
      list: vi.fn().mockResolvedValue({
        connection: SYNCED_PUBLIC,
        entries: makeEntries(120),
      }),
    });

    expect((await screen.findAllByRole("article")).length).toBe(120);

    // The grid mechanism: auto-fill minmax columns and zero min-width items
    // never force the page wider than the window.
    const grid = screen.getByRole("list");
    expect(grid).toHaveClass("grid");
    expect(grid).toHaveClass("grid-cols-[repeat(auto-fill,minmax(200px,1fr))]");
    for (const item of screen.getAllByRole("listitem")) {
      expect(item).toHaveClass("min-w-0");
    }
  });

  it("filters cards case-insensitively and predictably as the query changes", async () => {
    const user = userEvent.setup();
    renderPage({
      list: vi.fn().mockResolvedValue({
        connection: SYNCED_PUBLIC,
        entries: [
          { provider: "steam", externalGameId: "730", name: "Counter-Strike 2" },
          { provider: "steam", externalGameId: "4000", name: "Portal" },
          { provider: "steam", externalGameId: "70", name: "Half-Life" },
        ],
      }),
    });

    await screen.findByText("Counter-Strike 2");

    const search = screen.getByLabelText("Buscar na biblioteca");
    await user.type(search, "cOuNtEr");
    expect(screen.getAllByRole("article")).toHaveLength(1);
    expect(screen.getByText("Counter-Strike 2")).toBeInTheDocument();

    await user.clear(search);
    expect(screen.getAllByRole("article")).toHaveLength(3);

    await user.type(search, "portal");
    expect(screen.getAllByRole("article")).toHaveLength(1);
    expect(screen.getByText("Portal")).toBeInTheDocument();
  });

  it("searches by the catalog identity name when enriched", async () => {
    const user = userEvent.setup();
    renderPage({
      list: vi.fn().mockResolvedValue({
        connection: SYNCED_PUBLIC,
        entries: [
          {
            provider: "steam",
            externalGameId: "620",
            name: "portal2app",
            enrichmentStatus: "enriched",
            catalogIdentity: { id: "identity-1", name: "Portal 2", media: {} },
          },
        ],
      }),
    });

    await screen.findByText("Portal 2");
    await user.type(screen.getByLabelText("Buscar na biblioteca"), "portal 2");

    expect(screen.getAllByRole("article")).toHaveLength(1);
    expect(screen.queryByText("portal2app")).not.toBeInTheDocument();
  });

  it("announces the result count while searching", async () => {
    const user = userEvent.setup();
    renderPage({
      list: vi.fn().mockResolvedValue({
        connection: SYNCED_PUBLIC,
        entries: [
          { provider: "steam", externalGameId: "730", name: "Counter-Strike 2" },
          { provider: "steam", externalGameId: "4000", name: "Portal" },
          { provider: "steam", externalGameId: "70", name: "Half-Life" },
        ],
      }),
    });

    await screen.findByText("Counter-Strike 2");
    expect(screen.getByText("3 jogos")).toBeInTheDocument();

    const search = screen.getByLabelText("Buscar na biblioteca");
    await user.type(search, "half");
    expect(screen.getByText("1 jogo")).toBeInTheDocument();

    await user.clear(search);
    await user.type(search, "portal 2");
    expect(screen.getByText("0 jogos")).toBeInTheDocument();
    expect(
      screen.getByText("Nenhum jogo corresponde aos filtros."),
    ).toBeInTheDocument();
  });

  it("filters to installed games when the toggle is on", async () => {
    const user = userEvent.setup();
    renderPage({
      list: vi.fn().mockResolvedValue({
        connection: SYNCED_PUBLIC,
        entries: [
          { provider: "steam", externalGameId: "730", name: "Counter-Strike 2" },
          { provider: "steam", externalGameId: "4000", name: "Portal" },
        ],
      }),
      scan: vi.fn().mockResolvedValue({ games: [LOCAL_CS2], diagnostics: [] }),
    });

    await screen.findByText("Counter-Strike 2");
    expect(screen.getAllByRole("article")).toHaveLength(2);

    await user.click(screen.getByLabelText("Somente instalados"));
    expect(screen.getAllByRole("article")).toHaveLength(1);
    expect(screen.getByText("Counter-Strike 2")).toBeInTheDocument();
    expect(screen.queryByText("Portal")).not.toBeInTheDocument();

    await user.click(screen.getByLabelText("Somente instalados"));
    expect(screen.getAllByRole("article")).toHaveLength(2);
  });

  it("hides the provider filter while only one provider is present", async () => {
    renderPage({
      list: vi.fn().mockResolvedValue({
        connection: SYNCED_PUBLIC,
        entries: [REMOTE_CS2],
      }),
    });

    await screen.findByText("Counter-Strike 2");
    expect(screen.queryByLabelText("Provedor")).not.toBeInTheDocument();
  });

  it("shows the provider filter with two providers and filters by it", async () => {
    const user = userEvent.setup();
    renderPage({
      list: vi.fn().mockResolvedValue({
        connection: SYNCED_PUBLIC,
        entries: [
          { provider: "steam", externalGameId: "730", name: "Counter-Strike 2" },
          { provider: "epic", externalGameId: "portal-1", name: "Portal" },
        ],
      }),
    });

    await screen.findByText("Counter-Strike 2");

    const select = screen.getByLabelText("Provedor");
    expect(screen.getByRole("option", { name: "Todos" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "EPIC" })).toBeInTheDocument();

    await user.selectOptions(select, "epic");
    expect(screen.getAllByRole("article")).toHaveLength(1);
    expect(screen.getByText("Portal")).toBeInTheDocument();
    expect(screen.queryByText("Counter-Strike 2")).not.toBeInTheDocument();

    await user.selectOptions(select, "all");
    expect(screen.getAllByRole("article")).toHaveLength(2);
  });

  it("combines search, installed, and provider filters with AND", async () => {
    const user = userEvent.setup();
    renderPage({
      list: vi.fn().mockResolvedValue({
        connection: SYNCED_PUBLIC,
        entries: [
          { provider: "steam", externalGameId: "1", name: "Portal" },
          { provider: "epic", externalGameId: "2", name: "Portal" },
          { provider: "epic", externalGameId: "3", name: "Portal 2" },
        ],
      }),
      scan: vi.fn().mockResolvedValue({
        games: [
          { provider: "epic", externalGameId: 2, name: "Portal", state: "installed" },
        ],
        diagnostics: [],
      }),
    });

    await screen.findAllByText("Portal");
    expect(screen.getAllByRole("article")).toHaveLength(3);

    await user.type(screen.getByLabelText("Buscar na biblioteca"), "portal");
    expect(screen.getAllByRole("article")).toHaveLength(3);

    await user.click(screen.getByLabelText("Somente instalados"));
    expect(screen.getAllByRole("article")).toHaveLength(1);

    await user.selectOptions(screen.getByLabelText("Provedor"), "epic");
    expect(screen.getAllByRole("article")).toHaveLength(1);
    expect(screen.getByText("Portal")).toBeInTheDocument();
  });

  it("sorts by title with pt-aware ordering", async () => {
    const user = userEvent.setup();
    renderPage({
      list: vi.fn().mockResolvedValue({
        connection: SYNCED_PUBLIC,
        entries: [
          { provider: "steam", externalGameId: "1", name: "Zebra" },
          { provider: "steam", externalGameId: "2", name: "Bacana" },
          { provider: "steam", externalGameId: "3", name: "Água" },
          { provider: "steam", externalGameId: "4", name: "aorta" },
        ],
      }),
    });

    await screen.findByText("Zebra");
    await user.selectOptions(screen.getByLabelText("Ordenar por"), "title");

    expect(cardTitles()).toEqual(["Água", "aorta", "Bacana", "Zebra"]);
  });

  it("sorts by recent activity with missing activity last", async () => {
    const user = userEvent.setup();
    renderPage({
      list: vi.fn().mockResolvedValue({
        connection: SYNCED_PUBLIC,
        entries: [
          {
            provider: "steam",
            externalGameId: "1",
            name: "Old",
            lastActivityAt: "2026-08-01T00:00:00.000Z",
          },
          {
            provider: "steam",
            externalGameId: "2",
            name: "Recent",
            lastActivityAt: "2026-08-20T00:00:00.000Z",
          },
          { provider: "steam", externalGameId: "3", name: "Never" },
        ],
      }),
    });

    await screen.findByText("Old");
    await user.selectOptions(screen.getByLabelText("Ordenar por"), "activity");

    expect(cardTitles()).toEqual(["Recent", "Old", "Never"]);
  });

  it("sorts by playtime descending with missing playtime last", async () => {
    const user = userEvent.setup();
    renderPage({
      list: vi.fn().mockResolvedValue({
        connection: SYNCED_PUBLIC,
        entries: [
          {
            provider: "steam",
            externalGameId: "1",
            name: "Alpha",
            playtimeMinutes: 120,
          },
          { provider: "steam", externalGameId: "2", name: "Beta" },
          {
            provider: "steam",
            externalGameId: "3",
            name: "Gamma",
            playtimeMinutes: 60,
          },
          { provider: "steam", externalGameId: "4", name: "Delta" },
        ],
      }),
    });

    await screen.findByText("Alpha");
    await user.selectOptions(screen.getByLabelText("Ordenar por"), "playtime");

    expect(cardTitles()).toEqual(["Alpha", "Gamma", "Beta", "Delta"]);
  });

  it("renders the same title from two providers as distinct cards with badges and per-provider actions", async () => {
    renderPage({
      list: vi.fn().mockResolvedValue({
        connection: SYNCED_PUBLIC,
        entries: [
          { provider: "steam", externalGameId: "620", name: "Portal" },
          { provider: "epic", externalGameId: "portal", name: "Portal" },
        ],
      }),
      scan: vi.fn().mockResolvedValue({
        games: [
          { provider: "epic", externalGameId: "portal", name: "Portal", state: "installed" },
        ],
        diagnostics: [],
      }),
    });

    await screen.findAllByText("Portal");

    const cards = screen.getAllByRole("article");
    expect(cards).toHaveLength(2);

    const steamCard = cards[0];
    expect(within(steamCard).getByText("Steam")).toBeInTheDocument();
    expect(
      within(steamCard).getByRole("button", { name: "Instalar" }),
    ).toBeInTheDocument();

    const epicCard = cards[1];
    expect(within(epicCard).getByText("EPIC")).toBeInTheDocument();
    expect(within(epicCard).getByRole("button", { name: "Jogar" })).toBeInTheDocument();
  });

  it("shows enrichment badges for pending, failed, and unmatched without blocking actions", async () => {
    renderPage({
      list: vi.fn().mockResolvedValue({
        connection: SYNCED_PUBLIC,
        entries: [
          { provider: "steam", externalGameId: "1", name: "Pending", enrichmentStatus: "pending" },
          { provider: "steam", externalGameId: "2", name: "Failed", enrichmentStatus: "failed" },
          { provider: "steam", externalGameId: "3", name: "Unmatched", enrichmentStatus: "unmatched" },
          { provider: "steam", externalGameId: "4", name: "Enriched", enrichmentStatus: "enriched" },
        ],
      }),
    });

    await screen.findByText("Pending");
    expect(screen.getByText("Atualizando capa")).toBeInTheDocument();
    expect(screen.getByText("Catálogo indisponível")).toBeInTheDocument();
    expect(screen.getByText("Sem dados de catálogo")).toBeInTheDocument();

    // Every entry stays actionable, including the enriched one without badge.
    expect(screen.getAllByRole("button", { name: "Instalar" })).toHaveLength(4);
    const enrichedCard = screen.getAllByRole("article")[3];
    expect(
      within(enrichedCard).queryByText("Atualizando capa"),
    ).not.toBeInTheDocument();
    expect(
      within(enrichedCard).queryByText("Catálogo indisponível"),
    ).not.toBeInTheDocument();
    expect(
      within(enrichedCard).queryByText("Sem dados de catálogo"),
    ).not.toBeInTheDocument();
  });

  it("keeps the provider action working for an entry without catalog identity", async () => {
    const install = vi.fn().mockResolvedValue({ accepted: true });
    const user = userEvent.setup();
    renderPage({
      list: vi.fn().mockResolvedValue({
        connection: SYNCED_PUBLIC,
        entries: [{ provider: "steam", externalGameId: "70", name: "Half-Life" }],
      }),
      tauri: { launch: vi.fn(), install, getInstallStatus: vi.fn() },
    });

    const card = (await screen.findAllByRole("article"))[0];
    expect(within(card).getByText("H")).toBeInTheDocument();

    await user.click(within(card).getByRole("button", { name: "Instalar" }));
    await waitFor(() => expect(install).toHaveBeenCalledWith(70));
  });

  it("searches, filters, and sorts a 120-game collection predictably", async () => {
    const user = userEvent.setup();
    const entries = makeEntries(120);
    const installed = entries
      .filter((_, index) => index % 10 === 0)
      .map((entry) => ({
        provider: entry.provider,
        externalGameId: Number(entry.externalGameId),
        name: entry.name,
        state: "installed" as const,
      }));
    renderPage({
      list: vi.fn().mockResolvedValue({ connection: SYNCED_PUBLIC, entries }),
      scan: vi.fn().mockResolvedValue({ games: installed, diagnostics: [] }),
    });

    await screen.findAllByRole("article");
    expect(screen.getByText("120 jogos")).toBeInTheDocument();

    // "Jogo 1" matches the 3-digit names Jogo 100..Jogo 120 (21 games).
    await user.type(screen.getByLabelText("Buscar na biblioteca"), "jogo 1");
    expect(screen.getAllByRole("article")).toHaveLength(21);
    expect(screen.getByText("21 jogos")).toBeInTheDocument();

    await user.click(screen.getByLabelText("Somente instalados"));
    expect(cardTitles()).toEqual(["Jogo 101", "Jogo 111"]);

    await user.selectOptions(screen.getByLabelText("Ordenar por"), "title");
    expect(cardTitles()).toEqual(["Jogo 101", "Jogo 111"]);
  });

  it("keeps search, filters, sort, and card actions operable by keyboard", async () => {
    const user = userEvent.setup();
    renderPage({
      list: vi.fn().mockResolvedValue({
        connection: SYNCED_PUBLIC,
        entries: [
          { provider: "steam", externalGameId: "1", name: "Counter-Strike 2" },
          { provider: "epic", externalGameId: "2", name: "Portal" },
        ],
      }),
    });

    const search = await screen.findByLabelText("Buscar na biblioteca");
    await user.click(search);
    expect(search).toHaveFocus();

    await user.tab();
    expect(screen.getByLabelText("Somente instalados")).toHaveFocus();

    await user.tab();
    expect(screen.getByLabelText("Provedor")).toHaveFocus();

    await user.tab();
    expect(screen.getByLabelText("Ordenar por")).toHaveFocus();

    await user.tab();
    expect(
      screen.getAllByRole("button", { name: "Instalar" })[0],
    ).toHaveFocus();
  });

  it("keeps card actions reachable by keyboard without a provider filter", async () => {
    const user = userEvent.setup();
    renderPage({
      list: vi.fn().mockResolvedValue({
        connection: SYNCED_PUBLIC,
        entries: [REMOTE_CS2],
      }),
    });

    const search = await screen.findByLabelText("Buscar na biblioteca");
    await user.click(search);

    await user.tab();
    expect(screen.getByLabelText("Somente instalados")).toHaveFocus();

    await user.tab();
    expect(screen.getByLabelText("Ordenar por")).toHaveFocus();

    await user.tab();
    expect(screen.getByRole("button", { name: "Instalar" })).toHaveFocus();
  });

  it("links the card title to the game page when the entry has a catalog identity", async () => {
    renderPage({
      list: vi.fn().mockResolvedValue({
        connection: SYNCED_PUBLIC,
        entries: [
          {
            provider: "steam",
            externalGameId: "730",
            name: "Counter-Strike 2",
            enrichmentStatus: "enriched",
            catalogIdentity: {
              id: "identity-1",
              name: "Counter-Strike 2",
              media: {},
            },
          },
          {
            provider: "steam",
            externalGameId: "4000",
            name: "Garry's Mod",
          },
        ],
      }),
    });

    await screen.findByText("Counter-Strike 2");

    const link = screen.getByRole("link", { name: "Counter-Strike 2" });
    expect(link).toHaveAttribute("href", "/games/identity-1");
    // A title without an identity stays a plain heading, not a link.
    const cards = screen.getAllByRole("article");
    expect(cards).toHaveLength(2);
    expect(
      within(cards[1]).getByRole("heading", { name: "Garry's Mod" }),
    ).toBeInTheDocument();
    expect(within(cards[1]).queryByRole("link")).not.toBeInTheDocument();
  });
});
