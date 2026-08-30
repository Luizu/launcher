import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type {
  GameCatalogIdentity,
  GameLibraryConnection,
  GameLibraryEntry,
  GameLibraryResponse,
  LocalGame,
  LocalLibrarySnapshot,
} from "@launcher/contracts";
import { GAME_LIBRARY_QUERY_KEY } from "../platform-connections/use-steam-connection";
import { LOCAL_LIBRARY_QUERY_KEY } from "../local-library/use-local-library";
import type { GameLibraryClientLike } from "../game-library/game-library-client";
import type { LocalLibraryClientLike } from "../local-library/local-library-client";
import type { GameActionsClientLike } from "../game-library/use-game-actions";
import { GamePage } from "../game-page/game-page";
import { mockMatchMedia, restoreMatchMedia } from "../../test/match-media";
import { HERO_DEBOUNCE_MS } from "./use-home";
import { HomePage } from "./home-page";

const SYNCED_PUBLIC: GameLibraryConnection = {
  provider: "steam",
  visibility: "public",
  syncStatus: "synced",
  lastSyncedAt: "2026-08-28T00:00:00.000Z",
};

const FAILED_PUBLIC: GameLibraryConnection = {
  ...SYNCED_PUBLIC,
  syncStatus: "failed",
};

const CS2_IDENTITY: GameCatalogIdentity = {
  id: "identity-1",
  name: "Counter-Strike 2",
  description: "O jogo de tiro competitivo definitivo.",
  media: {
    screenshot: [
      { purpose: "hero", url: "https://cdn.example/cs2-hero.jpg", width: 1920, height: 1080 },
    ],
    cover: [
      { purpose: "selector", url: "https://cdn.example/cs2-cover.jpg", width: 460, height: 215 },
    ],
  },
};

function entry(overrides: Partial<GameLibraryEntry> = {}): GameLibraryEntry {
  return {
    provider: "steam",
    externalGameId: "730",
    name: "Counter-Strike 2",
    enrichmentStatus: "enriched",
    catalogIdentity: null,
    lastActivityAt: "2026-08-28T10:00:00.000Z",
    ...overrides,
  };
}

const LOCAL_CS2: LocalGame = {
  provider: "steam",
  externalGameId: 730,
  name: "csgo",
  state: "installed",
};

const LOCAL_GARRY: LocalGame = {
  provider: "steam",
  externalGameId: 4000,
  name: "Garry's Mod",
  state: "installed",
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

interface RenderHomeOptions {
  connection?: GameLibraryConnection;
  entries?: GameLibraryEntry[];
  localGames?: LocalGame[];
  /** Seeds both query caches; false lets the clients' promises drive. */
  seed?: boolean;
  list?: () => Promise<GameLibraryResponse>;
  scan?: () => Promise<LocalLibrarySnapshot>;
  tauri?: GameActionsClientLike;
}

function renderHome({
  connection = SYNCED_PUBLIC,
  entries = [],
  localGames = [],
  seed = true,
  list,
  scan,
  tauri,
}: RenderHomeOptions = {}) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  if (seed) {
    queryClient.setQueryData(GAME_LIBRARY_QUERY_KEY, { connection, entries });
    queryClient.setQueryData(LOCAL_LIBRARY_QUERY_KEY, {
      games: localGames,
      diagnostics: [],
    });
  }
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/home"]}>
        <HomePage
          gameLibrary={gameLibraryClient(
            list ?? vi.fn().mockResolvedValue({ connection, entries }),
          )}
          localLibrary={localLibraryClient(
            scan ?? vi.fn().mockResolvedValue({ games: localGames, diagnostics: [] }),
          )}
          tauri={tauri}
          openUrl={vi.fn().mockResolvedValue(undefined)}
        />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return queryClient;
}

const heroStage = () => screen.getByLabelText("Jogo em destaque");
const selectorSection = () => screen.getByLabelText("Seletor de jogos");

describe("HomePage", () => {
  it("shows the featured game with hero copy, media, and actions without opening the Library", () => {
    renderHome({
      entries: [
        entry({ catalogIdentity: CS2_IDENTITY, playtimeMinutes: 480 }),
      ],
      localGames: [LOCAL_CS2],
    });

    // The Home is the next-action surface: no need to visit the Library.
    expect(screen.getByRole("heading", { name: "Counter-Strike 2" })).toBeInTheDocument();
    expect(screen.getByText("Continuar jogando")).toBeInTheDocument();
    expect(
      screen.getByText("O jogo de tiro competitivo definitivo."),
    ).toBeInTheDocument();
    expect(within(heroStage()).getByText("Steam")).toBeInTheDocument();
    expect(screen.getByText("8h jogados")).toBeInTheDocument();
    expect(screen.getByText("Instalado")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Jogar" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Detalhes" })).toBeInTheDocument();
    // The catalog hero variant is the stage media.
    const stageImage = heroStage().querySelector("img");
    expect(stageImage).toHaveAttribute("src", "https://cdn.example/cs2-hero.jpg");
  });

  it("keeps the primary action neutral while the local scan is pending", async () => {
    renderHome({
      seed: false,
      list: vi.fn().mockResolvedValue({
        connection: SYNCED_PUBLIC,
        entries: [entry()],
      }),
      scan: never,
    });

    // The remote list rendered, but the install state is untrustworthy until
    // the local scan lands: a disabled placeholder instead of a misleading
    // action.
    expect(await screen.findByRole("heading", { name: "Counter-Strike 2" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Verificando…" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Instalar" })).not.toBeInTheDocument();
  });

  it("shows a skeleton while the library loads", () => {
    renderHome({
      seed: false,
      list: never,
      scan: never,
    });

    expect(
      screen.getByRole("status", { name: "Carregando sua biblioteca" }),
    ).toBeInTheDocument();
  });

  it("shows an actionable empty state with a path to the Library when nothing can be featured", () => {
    renderHome({ entries: [], localGames: [] });

    expect(screen.queryByLabelText("Jogo em destaque")).not.toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Ir para a Biblioteca" }),
    ).toHaveAttribute("href", "/library");
    expect(screen.queryByRole("button", { name: "Jogar" })).not.toBeInTheDocument();
  });

  it("keeps the hero composed from provider artwork when catalog media is missing", () => {
    renderHome({
      entries: [entry({ artwork: "https://cdn.example/provider-cs2.jpg" })],
      localGames: [LOCAL_CS2],
    });

    expect(screen.getByRole("heading", { name: "Counter-Strike 2" })).toBeInTheDocument();
    const stageImage = heroStage().querySelector("img");
    expect(stageImage).toHaveAttribute("src", "https://cdn.example/provider-cs2.jpg");
    expect(screen.getByRole("button", { name: "Jogar" })).toBeInTheDocument();
  });

  it("derives a title composition when neither catalog nor provider media exists", () => {
    renderHome({ entries: [entry({ artwork: null })], localGames: [LOCAL_CS2] });

    expect(screen.getByRole("heading", { name: "Counter-Strike 2" })).toBeInTheDocument();
    expect(heroStage().querySelector("img")).toBeNull();
    expect(screen.getByRole("button", { name: "Jogar" })).toBeInTheDocument();
  });

  it("does not let pending catalog enrichment block the stage or the action", () => {
    renderHome({
      entries: [
        entry({ enrichmentStatus: "pending", catalogIdentity: null, artwork: null }),
      ],
      localGames: [LOCAL_CS2],
    });

    expect(screen.getByRole("heading", { name: "Counter-Strike 2" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Jogar" })).toBeInTheDocument();
    expect(screen.queryByLabelText("Jogo em destaque")).not.toBeNull();
  });

  it("lists the installed games in the floating selector with count and active emphasis", () => {
    renderHome({
      entries: [entry({ catalogIdentity: CS2_IDENTITY })],
      localGames: [LOCAL_CS2, LOCAL_GARRY],
    });

    expect(screen.getByText("Jogos instalados")).toBeInTheDocument();
    expect(screen.getByText("2 neste PC")).toBeInTheDocument();
    // The selector floats inside the scene below the topbar with breathing
    // room — never a bottom dock.
    expect(selectorSection()).toHaveClass("absolute", "top-[145px]");
    // Its row scrolls horizontally for overflow.
    expect(within(selectorSection()).getByRole("list")).toHaveClass("overflow-x-auto");
    const featuredItem = screen.getByRole("button", { name: "Counter-Strike 2 (Steam)" });
    const otherItem = screen.getByRole("button", { name: "Garry's Mod (Steam)" });
    expect(featuredItem).toHaveAttribute("aria-current", "true");
    expect(otherItem).not.toHaveAttribute("aria-current");
  });

  it("shows the selector with prioritized library games and a working Instalar when nothing is installed", async () => {
    const install = vi.fn().mockResolvedValue({ accepted: true });
    const user = userEvent.setup();
    renderHome({
      entries: [
        entry({ lastActivityAt: "2026-08-28T10:00:00.000Z" }),
        entry({
          externalGameId: "4000",
          name: "Garry's Mod",
          lastActivityAt: "2026-08-27T10:00:00.000Z",
        }),
      ],
      localGames: [],
      tauri: { launch: vi.fn(), install, getInstallStatus: vi.fn() },
    });

    // The scene features the most recent activity; the selector floats with
    // the next prioritized game even though nothing is installed.
    expect(screen.getByRole("heading", { name: "Counter-Strike 2" })).toBeInTheDocument();
    expect(selectorSection()).toBeInTheDocument();
    expect(screen.getByText("Sua biblioteca")).toBeInTheDocument();
    expect(screen.queryByText("Jogos instalados")).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Garry's Mod (Steam)" }),
    ).toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: "Instalar Garry's Mod" }),
    );
    await waitFor(() => expect(install).toHaveBeenCalledWith(4000));
  });

  it("keeps the featured game when a fallback tile's Instalar is clicked", () => {
    vi.useFakeTimers();
    try {
      const install = vi.fn().mockResolvedValue({ accepted: true });
      renderHome({
        entries: [
          entry({ lastActivityAt: "2026-08-28T10:00:00.000Z" }),
          entry({
            externalGameId: "4000",
            name: "Garry's Mod",
            lastActivityAt: "2026-08-27T10:00:00.000Z",
          }),
        ],
        localGames: [],
        tauri: { launch: vi.fn(), install, getInstallStatus: vi.fn() },
      });

      expect(
        screen.getByRole("heading", { name: "Counter-Strike 2" }),
      ).toBeInTheDocument();

      // A real click focuses the action button first, then activates it;
      // neither may move the hero to the tile's game.
      fireEvent.focus(
        screen.getByRole("button", { name: "Instalar Garry's Mod" }),
      );
      fireEvent.click(
        screen.getByRole("button", { name: "Instalar Garry's Mod" }),
      );
      act(() => vi.advanceTimersByTime(HERO_DEBOUNCE_MS + 1000));

      expect(
        screen.getByRole("heading", { name: "Counter-Strike 2" }),
      ).toBeInTheDocument();
      expect(
        screen.queryByRole("heading", { name: "Garry's Mod" }),
      ).not.toBeInTheDocument();
      expect(install).toHaveBeenCalledWith(4000);
    } finally {
      vi.useRealTimers();
    }
  });

  it("never nests the Instalar action inside the selector tile", () => {
    renderHome({
      entries: [
        entry({ lastActivityAt: "2026-08-28T10:00:00.000Z" }),
        entry({
          externalGameId: "4000",
          name: "Garry's Mod",
          lastActivityAt: "2026-08-27T10:00:00.000Z",
        }),
      ],
      localGames: [],
    });

    // Tiles are single tab stops; an interactive descendant would nest a
    // button inside a button (invalid HTML, bubbling clicks).
    expect(document.querySelectorAll("button button")).toHaveLength(0);
  });

  it("keeps a focused fallback tile mounted and active after the debounce commits it", () => {
    vi.useFakeTimers();
    try {
      renderHome({
        entries: [
          entry({ lastActivityAt: "2026-08-28T10:00:00.000Z" }),
          entry({
            externalGameId: "4000",
            name: "Garry's Mod",
            lastActivityAt: "2026-08-27T10:00:00.000Z",
          }),
        ],
        localGames: [],
      });

      const featuredTile = screen.getByRole("button", {
        name: "Counter-Strike 2 (Steam)",
      });
      expect(featuredTile).toHaveAttribute("aria-current", "true");

      const garryTile = screen.getByRole("button", {
        name: "Garry's Mod (Steam)",
      });
      act(() => garryTile.focus());
      act(() => vi.advanceTimersByTime(HERO_DEBOUNCE_MS));

      // Committing the focused tile must not unmount it: the fallback row
      // keeps the featured game inside it, so focus stays on the tile.
      expect(
        screen.getByRole("heading", { name: "Garry's Mod" }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "Garry's Mod (Steam)" }),
      ).toBeInTheDocument();
      expect(garryTile).toHaveAttribute("aria-current", "true");
      expect(document.activeElement).toBe(garryTile);
    } finally {
      vi.useRealTimers();
    }
  });

  it("features the first library game when nothing is prioritized so the selector never hides", () => {
    renderHome({
      entries: [
        entry({ lastActivityAt: null }),
        entry({
          externalGameId: "4000",
          name: "Garry's Mod",
          lastActivityAt: null,
        }),
      ],
      localGames: [],
    });

    expect(screen.getByRole("heading", { name: "Counter-Strike 2" })).toBeInTheDocument();
    expect(selectorSection()).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Garry's Mod (Steam)" }),
    ).toBeInTheDocument();
  });

  it("commits a focused selector game to the hero after the debounce without launching", () => {
    vi.useFakeTimers();
    try {
      const launch = vi.fn().mockResolvedValue({ accepted: true });
      renderHome({
        entries: [entry({ catalogIdentity: CS2_IDENTITY })],
        localGames: [LOCAL_CS2, LOCAL_GARRY],
        tauri: { launch, install: vi.fn(), getInstallStatus: vi.fn() },
      });

      expect(screen.getByRole("heading", { name: "Counter-Strike 2" })).toBeInTheDocument();

      fireEvent.focus(screen.getByRole("button", { name: "Garry's Mod (Steam)" }));

      // Debounce: the hero stays on the previous game until the delay elapses.
      expect(screen.getByRole("heading", { name: "Counter-Strike 2" })).toBeInTheDocument();
      expect(launch).not.toHaveBeenCalled();

      act(() => vi.advanceTimersByTime(HERO_DEBOUNCE_MS));

      expect(screen.getByRole("heading", { name: "Garry's Mod" })).toBeInTheDocument();
      expect(launch).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("moves between selector games with the arrow keys", () => {
    vi.useFakeTimers();
    try {
      renderHome({
        entries: [entry({ catalogIdentity: CS2_IDENTITY })],
        localGames: [LOCAL_CS2, LOCAL_GARRY],
      });

      act(() =>
        screen.getByRole("button", { name: "Counter-Strike 2 (Steam)" }).focus(),
      );
      fireEvent.keyDown(within(selectorSection()).getByRole("list"), {
        key: "ArrowRight",
      });

      expect(document.activeElement).toBe(
        screen.getByRole("button", { name: "Garry's Mod (Steam)" }),
      );

      act(() => vi.advanceTimersByTime(HERO_DEBOUNCE_MS));
      expect(screen.getByRole("heading", { name: "Garry's Mod" })).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("launches the featured installed game through the native client", async () => {
    const launch = vi.fn().mockResolvedValue({ accepted: true });
    const user = userEvent.setup();
    renderHome({
      entries: [entry({ catalogIdentity: CS2_IDENTITY })],
      localGames: [LOCAL_CS2],
      tauri: { launch, install: vi.fn(), getInstallStatus: vi.fn() },
    });

    await user.click(screen.getByRole("button", { name: "Jogar" }));

    await waitFor(() => expect(launch).toHaveBeenCalledWith(730));
  });

  it("requests installation for a known not-installed featured game", async () => {
    const install = vi.fn().mockResolvedValue({ accepted: true });
    const user = userEvent.setup();
    renderHome({
      entries: [entry()],
      localGames: [],
      tauri: { launch: vi.fn(), install, getInstallStatus: vi.fn() },
    });

    expect(screen.getByRole("heading", { name: "Counter-Strike 2" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Instalar" }));

    await waitFor(() => expect(install).toHaveBeenCalledWith(730));
  });

  it("keeps same-looking entries from different providers distinguishable by badge and own action", () => {
    vi.useFakeTimers();
    try {
      renderHome({
        entries: [
          entry({
            provider: "steam",
            externalGameId: "12345",
            name: "Cyber City",
            lastActivityAt: "2026-08-28T09:00:00.000Z",
          }),
          entry({
            provider: "epic",
            externalGameId: "98765",
            name: "Cyber City",
            lastActivityAt: null,
          }),
        ],
        localGames: [
          { provider: "steam", externalGameId: 12345, name: "Cyber City", state: "installed" },
          { provider: "epic", externalGameId: 98765, name: "Cyber City", state: "installed" },
        ],
      });

      // The featured (active) entry carries its own provider badge…
      expect(within(heroStage()).getByText("Steam")).toBeInTheDocument();
      // …and the selector items stay distinguishable by provider label.
      expect(
        screen.getByRole("button", { name: "Cyber City (Steam)" }),
      ).toBeInTheDocument();
      const epicItem = screen.getByRole("button", { name: "Cyber City (EPIC)" });
      expect(epicItem).toBeInTheDocument();

      // Focusing the epic entry switches the hero to that provider's entry
      // and its own action (badge + launch state come from the entry).
      fireEvent.focus(epicItem);
      act(() => vi.advanceTimersByTime(HERO_DEBOUNCE_MS));

      expect(within(heroStage()).getByText("EPIC")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Jogar" })).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("shows a subtle stale note near the meta when the connection failed, keeping the hero", () => {
    renderHome({
      connection: FAILED_PUBLIC,
      entries: [entry({ catalogIdentity: CS2_IDENTITY })],
      localGames: [LOCAL_CS2],
    });

    expect(screen.getByText("mostrando última sincronização")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Counter-Strike 2" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Jogar" })).toBeInTheDocument();
  });

  it("hides the stale note when the connection is synced", () => {
    renderHome({
      entries: [entry()],
      localGames: [LOCAL_CS2],
    });

    expect(screen.queryByText("mostrando última sincronização")).not.toBeInTheDocument();
  });

  it("shows Detalhes only when a catalog identity exists", () => {
    renderHome({ entries: [entry()], localGames: [LOCAL_CS2] });

    expect(screen.queryByRole("link", { name: "Detalhes" })).not.toBeInTheDocument();
  });

  it("navigates Detalhes to the real game page by identity id", async () => {
    const user = userEvent.setup();
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    queryClient.setQueryData(GAME_LIBRARY_QUERY_KEY, {
      connection: SYNCED_PUBLIC,
      entries: [entry({ catalogIdentity: CS2_IDENTITY })],
    });
    queryClient.setQueryData(LOCAL_LIBRARY_QUERY_KEY, {
      games: [LOCAL_CS2],
      diagnostics: [],
    });
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={["/home"]}>
          <Routes>
            <Route path="/home" element={<HomePage />} />
            <Route
              path="/games/:identityId"
              element={
                <GamePage
                  gamePages={{
                    getGamePage: vi.fn().mockResolvedValue({
                      identity: CS2_IDENTITY,
                      entries: [
                        {
                          provider: "steam",
                          externalGameId: "730",
                          name: "Counter-Strike 2",
                          playtimeMinutes: 480,
                          lastActivityAt: "2026-08-28T10:00:00.000Z",
                          enrichmentStatus: "enriched",
                        },
                      ],
                    }),
                  }}
                  localLibrary={localLibraryClient(
                    vi.fn().mockResolvedValue({
                      games: [LOCAL_CS2],
                      diagnostics: [],
                    }),
                  )}
                  tauri={{ launch: vi.fn(), install: vi.fn(), getInstallStatus: vi.fn() }}
                />
              }
            />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    await user.click(await screen.findByRole("link", { name: "Detalhes" }));

    expect(
      await screen.findByRole("heading", { name: "Counter-Strike 2" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Provedores" }),
    ).toBeInTheDocument();
    expect(screen.getByText("8h jogados")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Voltar" }));
    expect(
      screen.getByLabelText("Jogo em destaque"),
    ).toBeInTheDocument();
  });

  it("surfaces action errors with a retry", async () => {
    const launch = vi
      .fn()
      .mockRejectedValueOnce({ code: "open-failed" })
      .mockResolvedValue({ accepted: true });
    const user = userEvent.setup();
    renderHome({
      entries: [entry({ catalogIdentity: CS2_IDENTITY })],
      localGames: [LOCAL_CS2],
      tauri: { launch, install: vi.fn(), getInstallStatus: vi.fn() },
    });

    await user.click(screen.getByRole("button", { name: "Jogar" }));
    expect(
      await screen.findByText("A Steam não abriu. Verifique se ela está em execução e tente novamente."),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Tentar novamente" }));
    await waitFor(() => expect(launch).toHaveBeenCalledTimes(2));
  });

  it("stays empty-state only when there is genuinely nothing to feature (local-only library still shows a hero)", () => {
    renderHome({
      entries: [],
      localGames: [LOCAL_GARRY],
    });

    expect(screen.getByRole("heading", { name: "Garry's Mod" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Jogar" })).toBeInTheDocument();
  });
});

afterEach(restoreMatchMedia);

describe("HomePage responsividade e acessibilidade", () => {
  it("compacts the floating selector on narrow windows while keeping horizontal scroll", () => {
    mockMatchMedia("(max-width: 800px)", true);
    renderHome({
      entries: [entry({ catalogIdentity: CS2_IDENTITY })],
      localGames: [LOCAL_CS2, LOCAL_GARRY],
    });

    expect(selectorSection()).toHaveClass("top-[109px]");
    expect(selectorSection()).not.toHaveClass("top-[145px]");
    expect(within(selectorSection()).getByRole("list")).toHaveClass("overflow-x-auto");
  });

  it("loads the hero media eagerly and the selector covers lazily", () => {
    renderHome({
      entries: [
        entry({ catalogIdentity: CS2_IDENTITY }),
        entry({
          externalGameId: "4000",
          name: "Garry's Mod",
          artwork: "https://cdn.example/gmod.jpg",
        }),
      ],
      localGames: [LOCAL_CS2, LOCAL_GARRY],
    });

    const stageImage = heroStage().querySelector("img");
    expect(stageImage).toHaveAttribute("loading", "eager");
    expect(stageImage).not.toHaveAttribute("loading", "lazy");

    const covers = selectorSection().querySelectorAll("img");
    expect(covers.length).toBeGreaterThan(0);
    for (const cover of covers) {
      expect(cover).toHaveAttribute("loading", "lazy");
      expect(cover).toHaveAttribute("decoding", "async");
    }
  });

  it("renders selector items with visible keyboard focus styles", () => {
    renderHome({
      entries: [entry({ catalogIdentity: CS2_IDENTITY })],
      localGames: [LOCAL_CS2, LOCAL_GARRY],
    });

    const featuredItem = screen.getByRole("button", { name: "Counter-Strike 2 (Steam)" });
    expect(featuredItem.className).toMatch(/focus-visible:outline/);
    const otherItem = screen.getByRole("button", { name: "Garry's Mod (Steam)" });
    expect(otherItem.className).toMatch(/focus-visible:outline/);
  });

  it("activates Jogar with Enter from the keyboard", async () => {
    const launch = vi.fn().mockResolvedValue({ accepted: true });
    const user = userEvent.setup();
    renderHome({
      entries: [entry({ catalogIdentity: CS2_IDENTITY })],
      localGames: [LOCAL_CS2],
      tauri: { launch, install: vi.fn(), getInstallStatus: vi.fn() },
    });

    screen.getByRole("button", { name: "Jogar" }).focus();
    await user.keyboard("{Enter}");

    await waitFor(() => expect(launch).toHaveBeenCalledWith(730));
  });

  it("activates Jogar with Space from the keyboard", async () => {
    const launch = vi.fn().mockResolvedValue({ accepted: true });
    const user = userEvent.setup();
    renderHome({
      entries: [entry({ catalogIdentity: CS2_IDENTITY })],
      localGames: [LOCAL_CS2],
      tauri: { launch, install: vi.fn(), getInstallStatus: vi.fn() },
    });

    screen.getByRole("button", { name: "Jogar" }).focus();
    await user.keyboard(" ");

    await waitFor(() => expect(launch).toHaveBeenCalledWith(730));
  });

  it("commits a selector game activated with Enter without launching it", async () => {
    const launch = vi.fn().mockResolvedValue({ accepted: true });
    const user = userEvent.setup();
    renderHome({
      entries: [entry({ catalogIdentity: CS2_IDENTITY })],
      localGames: [LOCAL_CS2, LOCAL_GARRY],
      tauri: { launch, install: vi.fn(), getInstallStatus: vi.fn() },
    });

    fireEvent.focus(screen.getByRole("button", { name: "Garry's Mod (Steam)" }));
    await user.keyboard("{Enter}");

    await waitFor(() =>
      expect(screen.getByRole("heading", { name: "Garry's Mod" })).toBeInTheDocument(),
    );
    expect(launch).not.toHaveBeenCalled();
  });
});
