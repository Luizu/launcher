import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactElement } from "react";
import { MemoryRouter } from "react-router-dom";
import { GameCard } from "./game-card";
import type { LibraryGame } from "../../lib/merge-library";

/** The card title links to the game page, so the card needs a router. */
function renderCard(ui: ReactElement) {
  return render(<MemoryRouter>{ui}</MemoryRouter>);
}

const INSTALLED_CS2: LibraryGame = {
  provider: "steam",
  externalGameId: "730",
  name: "Counter-Strike 2",
  installState: "installed",
};

it("launches an installed game and refreshes its local state", async () => {
  const game = {
    provider: "steam",
    externalGameId: "730",
    name: "Counter-Strike 2",
    installState: "installed",
  } as const;
  const launch = vi.fn().mockResolvedValue({ accepted: true });
  const user = userEvent.setup();

  renderCard(<GameCard game={game} onLaunch={launch} onInstall={vi.fn()} />);
  await user.click(screen.getByRole("button", { name: "Jogar" }));

  expect(launch).toHaveBeenCalledWith(game);
});

it("requests installation for a remote game that is not installed", async () => {
  const game = {
    provider: "steam",
    externalGameId: "730",
    name: "Counter-Strike 2",
    installState: "not-installed",
  } as const;
  const install = vi.fn().mockResolvedValue({ accepted: true });
  const user = userEvent.setup();

  renderCard(<GameCard game={game} onLaunch={vi.fn()} onInstall={install} />);
  await user.click(screen.getByRole("button", { name: "Instalar" }));

  expect(install).toHaveBeenCalledWith(game);
});

it("disables the action button while the action is pending", async () => {
  let resolveLaunch!: () => void;
  const launch = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        resolveLaunch = resolve;
      }),
  );
  const user = userEvent.setup();

  renderCard(<GameCard game={INSTALLED_CS2} onLaunch={launch} onInstall={vi.fn()} />);
  await user.click(screen.getByRole("button", { name: "Jogar" }));

  expect(screen.getByRole("button", { name: "Jogar" })).toBeDisabled();

  resolveLaunch();
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Jogar" })).toBeEnabled(),
  );
  expect(launch).toHaveBeenCalledTimes(1);
});

it("shows a neutral placeholder instead of an install action while the scan is pending", () => {
  renderCard(
    <GameCard
      game={{ ...INSTALLED_CS2, installState: "not-installed" }}
      scanPending
      onLaunch={vi.fn()}
      onInstall={vi.fn()}
    />,
  );

  expect(screen.getByRole("button", { name: "Verificando…" })).toBeDisabled();
  expect(screen.queryByRole("button", { name: "Instalar" })).not.toBeInTheDocument();
});

it("renders a disabled Instalando state while the game is installing", () => {
  renderCard(
    <GameCard
      game={{ ...INSTALLED_CS2, installState: "installing" }}
      onLaunch={vi.fn()}
      onInstall={vi.fn()}
      onCheckSteam={vi.fn()}
    />,
  );

  expect(screen.getByRole("button", { name: "Instalando…" })).toBeDisabled();
});

it("offers the Steam recovery action when the state is unknown", async () => {
  const game = { ...INSTALLED_CS2, installState: "unknown" } as const;
  const onCheckSteam = vi.fn();
  const user = userEvent.setup();

  renderCard(<GameCard game={game} onCheckSteam={onCheckSteam} />);
  await user.click(screen.getByRole("button", { name: "Verificar na Steam" }));

  expect(onCheckSteam).toHaveBeenCalledWith(game);
});

it("shows the provider badge with a PT-BR label", () => {
  renderCard(<GameCard game={INSTALLED_CS2} onLaunch={vi.fn()} onInstall={vi.fn()} />);

  expect(screen.getByText("Steam")).toBeInTheDocument();
});

it("falls back to the provider id for unknown providers", () => {
  renderCard(
    <GameCard
      game={{ ...INSTALLED_CS2, provider: "epic" }}
      onLaunch={vi.fn()}
      onInstall={vi.fn()}
    />,
  );

  expect(screen.getByText("EPIC")).toBeInTheDocument();
});

it.each([
  ["pending", "Atualizando capa"],
  ["failed", "Catálogo indisponível"],
  ["unmatched", "Sem dados de catálogo"],
] as const)(
  "shows the %s enrichment badge without blocking the action",
  (status, label) => {
    renderCard(
      <GameCard
        game={{ ...INSTALLED_CS2, enrichmentStatus: status }}
        onLaunch={vi.fn()}
        onInstall={vi.fn()}
      />,
    );

    expect(screen.getByText(label)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Jogar" })).toBeEnabled();
  },
);

it("shows no enrichment badge for enriched entries", () => {
  renderCard(
    <GameCard
      game={{ ...INSTALLED_CS2, enrichmentStatus: "enriched" }}
      onLaunch={vi.fn()}
      onInstall={vi.fn()}
    />,
  );

  expect(screen.queryByText("Atualizando capa")).not.toBeInTheDocument();
  expect(screen.queryByText("Catálogo indisponível")).not.toBeInTheDocument();
  expect(screen.queryByText("Sem dados de catálogo")).not.toBeInTheDocument();
});

it("uses canonical playtime and remote activity when both legacy aliases exist", () => {
  renderCard(
    <GameCard
      game={{
        ...INSTALLED_CS2,
        playtimeTotalMinutes: 2538,
        playtimeMinutes: 999,
        remoteLastPlayedAt: "2026-08-30T10:00:00.000Z",
        lastActivityAt: "2026-08-01T10:00:00.000Z",
      }}
      onLaunch={vi.fn()}
      onInstall={vi.fn()}
    />,
  );

  expect(screen.getByText("42h18 jogados")).toBeInTheDocument();
  expect(screen.getByText("Jogado em 30/08/2026")).toBeInTheDocument();
});

it("prefers the catalog identity name as the displayed title", () => {
  renderCard(
    <GameCard
      game={{
        ...INSTALLED_CS2,
        name: "portal2app",
        catalogIdentity: { id: "identity-1", name: "Portal 2", media: {} },
      }}
      onLaunch={vi.fn()}
      onInstall={vi.fn()}
    />,
  );

  expect(screen.getByText("Portal 2")).toBeInTheDocument();
  expect(screen.queryByText("portal2app")).not.toBeInTheDocument();
});

it("links the card title to the game page when a catalog identity exists", () => {
  renderCard(
    <GameCard
      game={{
        ...INSTALLED_CS2,
        catalogIdentity: { id: "identity-1", name: "Portal 2", media: {} },
      }}
      onLaunch={vi.fn()}
      onInstall={vi.fn()}
    />,
  );

  const link = screen.getByRole("link", { name: "Portal 2" });
  expect(link).toHaveAttribute("href", "/games/identity-1");
  expect(
    screen.queryByRole("heading", { name: "Portal 2" }),
  ).not.toBeInTheDocument();
});

it("keeps a plain heading title without a catalog identity", () => {
  renderCard(
    <GameCard
      game={{ ...INSTALLED_CS2, name: "Fallout" }}
      onLaunch={vi.fn()}
      onInstall={vi.fn()}
    />,
  );

  expect(
    screen.getByRole("heading", { name: "Fallout" }),
  ).toBeInTheDocument();
  expect(
    screen.queryByRole("link", { name: "Fallout" }),
  ).not.toBeInTheDocument();
});

it("renders a title-derived fallback tile when there is no catalog media", () => {
  const { container } = renderCard(
    <GameCard
      game={{ ...INSTALLED_CS2, name: "Fallout" }}
      onLaunch={vi.fn()}
      onInstall={vi.fn()}
    />,
  );

  expect(container.querySelector("img")).toBeNull();
  expect(screen.getByText("F")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Jogar" })).toBeEnabled();
});

it("renders the catalog selector cover when available", () => {
  const { container } = renderCard(
    <GameCard
      game={{
        ...INSTALLED_CS2,
        catalogIdentity: {
          id: "identity-1",
          name: "Counter-Strike 2",
          media: {
            cover: [
              {
                purpose: "selector",
                url: "https://cdn.example/cover.jpg",
                width: 90,
                height: 128,
              },
            ],
          },
        },
      }}
      onLaunch={vi.fn()}
      onInstall={vi.fn()}
    />,
  );

  const img = container.querySelector("img");
  expect(img).not.toBeNull();
  expect(img).toHaveAttribute("src", "https://cdn.example/cover.jpg");
  // Outside the hero everything loads lazily with async decoding.
  expect(img).toHaveAttribute("loading", "lazy");
  expect(img).toHaveAttribute("decoding", "async");
});

it("renders the approved landscape appearance for the library grid", () => {
  const { container } = renderCard(
    <GameCard
      appearance="library"
      game={{
        ...INSTALLED_CS2,
        name: "Hades II",
        artwork: "https://cdn.example/home-art.jpg",
      }}
      onLaunch={vi.fn()}
      onInstall={vi.fn()}
    />,
  );

  const article = container.querySelector("article");
  expect(article).toHaveAttribute("data-card-appearance", "library");
  expect(article?.querySelector("[data-game-cover]")).toHaveClass(
    "aspect-[1.9/1]",
  );
  expect(article?.querySelector("[data-game-status]")).toHaveTextContent(
    "Instalado · Steam",
  );
  expect(article?.querySelector("img")).toHaveAttribute(
    "src",
    "https://cdn.cloudflare.steamstatic.com/steam/apps/730/library_600x900_2x.jpg",
  );
});
