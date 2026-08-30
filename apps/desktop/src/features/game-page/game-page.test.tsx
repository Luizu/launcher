import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type {
  GamePageResponse,
  LocalLibrarySnapshot,
} from "@launcher/contracts";
import { ApiClientError } from "../../lib/api-client";
import type { GameActionsClientLike } from "../game-library/use-game-actions";
import type { LocalLibraryClientLike } from "../local-library/local-library-client";
import type { GamePagesClientLike } from "./game-page-client";
import { GamePage } from "./game-page";

const PAGE: GamePageResponse = {
  identity: {
    id: "identity-1",
    name: "Counter-Strike 2",
    description: "O jogo de tiro competitivo definitivo.",
    genres: ["Tiro", "Competitivo"],
    platforms: ["PC (Microsoft Windows)"],
    media: {
      screenshot: [
        {
          purpose: "game-page",
          url: "https://cdn.example/cs2-1080p.jpg",
          width: 1920,
          height: 1080,
        },
      ],
      cover: [
        {
          purpose: "selector",
          url: "https://cdn.example/cs2-cover.jpg",
          width: 90,
          height: 128,
        },
      ],
    },
  },
  entries: [
    {
      provider: "steam",
      externalGameId: "730",
      name: "Counter-Strike 2",
      playtimeMinutes: 480,
      lastActivityAt: "2026-08-27T10:00:00.000Z",
      enrichmentStatus: "enriched",
    },
    {
      provider: "epic",
      externalGameId: "98765",
      name: "Counter-Strike 2",
      playtimeMinutes: 60,
      lastActivityAt: null,
      enrichmentStatus: "enriched",
    },
  ],
};

const EMPTY_SNAPSHOT: LocalLibrarySnapshot = { games: [], diagnostics: [] };

const LOCAL_STEAM_CS2: LocalLibrarySnapshot = {
  games: [{ provider: "steam", externalGameId: 730, name: "csgo", state: "installed" }],
  diagnostics: [],
};

const never = <T,>(): Promise<T> => new Promise<T>(() => undefined);

function gamePagesClient(
  getGamePage: (identityId: string) => Promise<GamePageResponse>,
): GamePagesClientLike {
  return { getGamePage: vi.fn().mockImplementation(getGamePage) };
}

function localLibraryClient(
  scan: () => Promise<LocalLibrarySnapshot>,
): LocalLibraryClientLike {
  return { scan };
}

interface RenderGamePageOptions {
  getGamePage?: (identityId: string) => Promise<GamePageResponse>;
  scan?: () => Promise<LocalLibrarySnapshot>;
  tauri?: GameActionsClientLike;
  initialEntries?: string[];
}

function renderGamePage({
  getGamePage,
  scan,
  tauri,
  initialEntries = ["/games/identity-1"],
}: RenderGamePageOptions = {}) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={initialEntries}>
        <Routes>
          <Route path="/home" element={<div>HOME</div>} />
          <Route
            path="/games/:identityId"
            element={
              <GamePage
                gamePages={gamePagesClient(
                  getGamePage ?? vi.fn().mockResolvedValue(PAGE),
                )}
                localLibrary={localLibraryClient(
                  scan ?? vi.fn().mockResolvedValue(EMPTY_SNAPSHOT),
                )}
                tauri={tauri}
                openUrl={vi.fn().mockResolvedValue(undefined)}
              />
            }
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("GamePage", () => {
  it("renders the identity name, description, genres, platforms, and game-page media", async () => {
    const { container } = renderGamePage();

    expect(
      await screen.findByRole("heading", { name: "Counter-Strike 2" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("O jogo de tiro competitivo definitivo."),
    ).toBeInTheDocument();
    expect(screen.getByText("Tiro")).toBeInTheDocument();
    expect(screen.getByText("Competitivo")).toBeInTheDocument();
    expect(screen.getByText("PC (Microsoft Windows)")).toBeInTheDocument();
    const media = container.querySelector("img");
    expect(media).not.toBeNull();
    expect(media).toHaveAttribute(
      "src",
      "https://cdn.example/cs2-1080p.jpg",
    );
    // Outside the hero the page media loads lazily with async decoding.
    expect(media).toHaveAttribute("loading", "lazy");
    expect(media).toHaveAttribute("decoding", "async");
  });

  it("keeps Voltar a keyboard-visible focusable control", async () => {
    renderGamePage();

    await screen.findByRole("heading", { name: "Counter-Strike 2" });
    expect(screen.getByRole("button", { name: "Voltar" }).className).toMatch(
      /focus-visible:outline/,
    );
  });

  it("omits absent description, genres, and platforms gracefully", async () => {
    renderGamePage({
      getGamePage: vi.fn().mockResolvedValue({
        identity: {
          id: "identity-1",
          name: "Sem extras",
          media: {},
        },
        entries: [],
      }),
    });

    expect(
      await screen.findByRole("heading", { name: "Sem extras" }),
    ).toBeInTheDocument();
    expect(screen.queryByText("Tiro")).not.toBeInTheDocument();
    expect(
      screen.queryByText("PC (Microsoft Windows)"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText(/descrição|sobre/i),
    ).not.toBeInTheDocument();
  });

  it("shows a preparing-media indication while an entry enrichment is pending", async () => {
    renderGamePage({
      getGamePage: vi.fn().mockResolvedValue({
        identity: { id: "identity-1", name: "Counter-Strike 2", media: {} },
        entries: [
          {
            provider: "steam",
            externalGameId: "730",
            name: "Counter-Strike 2",
            enrichmentStatus: "pending",
          },
        ],
      }),
    });

    expect(
      await screen.findByText("Preparando mídia…"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Counter-Strike 2" }),
    ).toBeInTheDocument();
  });

  it("shows a subtle catalog-unavailable note when an entry enrichment failed", async () => {
    renderGamePage({
      getGamePage: vi.fn().mockResolvedValue({
        identity: { id: "identity-1", name: "Counter-Strike 2", media: {} },
        entries: [
          {
            provider: "steam",
            externalGameId: "730",
            name: "Counter-Strike 2",
            enrichmentStatus: "failed",
          },
        ],
      }),
    });

    expect(
      await screen.findByText("Catálogo indisponível no momento"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Counter-Strike 2" }),
    ).toBeInTheDocument();
  });

  it("renders title-derived fallback art for an enriched identity without media, without error copy", async () => {
    const { container } = renderGamePage({
      getGamePage: vi.fn().mockResolvedValue({
        identity: { id: "identity-1", name: "Counter-Strike 2", media: {} },
        entries: [
          {
            provider: "steam",
            externalGameId: "730",
            name: "Counter-Strike 2",
            enrichmentStatus: "enriched",
          },
        ],
      }),
    });

    expect(
      await screen.findByRole("heading", { name: "Counter-Strike 2" }),
    ).toBeInTheDocument();
    expect(container.querySelector("img")).toBeNull();
    expect(screen.getByText("C2")).toBeInTheDocument();
    expect(
      screen.queryByText(/não foi possível|indisponível/i),
    ).not.toBeInTheDocument();
  });

  it("lists each provider entry as its own row with badge, playtime, and action", async () => {
    renderGamePage({
      scan: vi.fn().mockResolvedValue(LOCAL_STEAM_CS2),
    });

    expect(
      await screen.findByRole("heading", { name: "Provedores" }),
    ).toBeInTheDocument();
    const rows = screen.getAllByRole("listitem");
    expect(rows).toHaveLength(2);
    const steamRow = rows[0]!;
    const epicRow = rows[1]!;
    expect(within(steamRow).getByText("Steam")).toBeInTheDocument();
    expect(within(steamRow).getByText("8h jogados")).toBeInTheDocument();
    expect(
      within(steamRow).getByRole("button", { name: "Jogar" }),
    ).toBeInTheDocument();
    expect(within(epicRow).getByText("EPIC")).toBeInTheDocument();
    expect(within(epicRow).getByText("1h jogados")).toBeInTheDocument();
    expect(
      within(epicRow).getByRole("button", { name: "Instalar" }),
    ).toBeInTheDocument();
  });

  it("wires each row action to its own provider entry", async () => {
    const launch = vi.fn().mockResolvedValue({ accepted: true });
    const install = vi.fn().mockResolvedValue({ accepted: true });
    const user = userEvent.setup();
    renderGamePage({
      scan: vi.fn().mockResolvedValue({
        games: [
          { provider: "steam", externalGameId: 730, name: "csgo", state: "installed" },
        ],
        diagnostics: [],
      }),
      getGamePage: vi.fn().mockResolvedValue({
        identity: { id: "identity-1", name: "Counter-Strike 2", media: {} },
        entries: [
          {
            provider: "steam",
            externalGameId: "730",
            name: "Counter-Strike 2",
            enrichmentStatus: "enriched",
          },
          {
            provider: "steam",
            externalGameId: "4000",
            name: "Garry's Mod",
            enrichmentStatus: "enriched",
          },
        ],
      }),
      tauri: { launch, install, getInstallStatus: vi.fn() },
    });

    await screen.findByRole("heading", { name: "Provedores" });
    const rows = screen.getAllByRole("listitem");
    await user.click(
      within(rows[0]!).getByRole("button", { name: "Jogar" }),
    );
    await user.click(
      within(rows[1]!).getByRole("button", { name: "Instalar" }),
    );

    await waitFor(() => expect(launch).toHaveBeenCalledWith(730));
    await waitFor(() => expect(install).toHaveBeenCalledWith(4000));
  });

  it("wires a non-Steam provider row to the action engine, which refuses with PT-BR copy", async () => {
    const user = userEvent.setup();
    renderGamePage();

    await screen.findByRole("heading", { name: "Provedores" });
    const rows = screen.getAllByRole("listitem");
    // The epic entry is not installed, so its row offers Instalar; the
    // Steam-only engine refuses the action with a stable PT-BR message
    // instead of a broken click.
    await user.click(
      within(rows[1]!).getByRole("button", { name: "Instalar" }),
    );

    expect(
      await screen.findByText(
        "Não foi possível identificar este jogo na Steam.",
      ),
    ).toBeInTheDocument();
  });

  it("returns to the previous route with Voltar", async () => {
    const user = userEvent.setup();
    renderGamePage({ initialEntries: ["/home", "/games/identity-1"] });

    await user.click(
      await screen.findByRole("button", { name: "Voltar" }),
    );

    expect(screen.getByText("HOME")).toBeInTheDocument();
  });

  it("shows a loading skeleton while the page loads", () => {
    renderGamePage({ getGamePage: never });

    expect(
      screen.getByRole("status", { name: "Carregando a página do jogo" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Voltar" }),
    ).toBeInTheDocument();
  });

  it("shows an actionable not-found state for an unknown identity id", async () => {
    const user = userEvent.setup();
    renderGamePage({
      initialEntries: ["/home", "/games/unknown-id"],
      getGamePage: vi.fn().mockRejectedValue(
        new ApiClientError(
          404,
          "catalog_identity_not_found",
          "catalog identity not found",
          "check the game page link and try again",
        ),
      ),
    });

    expect(
      await screen.findByText("Não encontramos este jogo."),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "O link pode estar incorreto ou a página ainda não está disponível.",
      ),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Voltar" }));
    expect(screen.getByText("HOME")).toBeInTheDocument();
  });

  it("recovers from a load error with a retry action", async () => {
    const user = userEvent.setup();
    const getGamePage = vi
      .fn<() => Promise<GamePageResponse>>()
      .mockRejectedValueOnce(
        new ApiClientError(
          503,
          "game_page_unavailable",
          "game page is temporarily unavailable",
          "retry the request later",
        ),
      )
      .mockResolvedValueOnce(PAGE);
    renderGamePage({ getGamePage });

    expect(
      await screen.findByText("Não foi possível carregar a página do jogo."),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Tentar novamente" }));

    expect(
      await screen.findByRole("heading", { name: "Counter-Strike 2" }),
    ).toBeInTheDocument();
  });

  it("reserves a community area with coming-soon copy", async () => {
    renderGamePage();

    expect(
      await screen.findByRole("heading", { name: "Comunidade" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("As comunidades chegam em breve."),
    ).toBeInTheDocument();
  });

  it("never renders video or audio elements", () => {
    const { container } = renderGamePage();

    expect(container.querySelector("video, audio, source")).toBeNull();
  });
});
