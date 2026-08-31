import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { ReactElement } from "react";
import type { LibraryGame } from "../../lib/merge-library";
import { REDUCED_MOTION_QUERY } from "../../lib/use-media-query";
import { mockMatchMedia, restoreMatchMedia } from "../../test/match-media";
import type { UseGameActionsResult } from "../game-library/use-game-actions";
import { HeroStage } from "./hero-stage";

/** Media-bearing games so the hero walks the media path, not the fallback. */
const GAME_A: LibraryGame = {
  provider: "steam",
  externalGameId: "730",
  name: "Counter-Strike 2",
  installState: "installed",
  catalogIdentity: {
    id: "identity-1",
    name: "Counter-Strike 2",
    media: {
      screenshot: [
        { purpose: "hero", url: "https://cdn.example/a-hero.jpg", width: 1920, height: 1080 },
      ],
    },
  },
};

const GAME_B: LibraryGame = {
  provider: "steam",
  externalGameId: "4000",
  name: "Garry's Mod",
  installState: "installed",
  catalogIdentity: {
    id: "identity-2",
    name: "Garry's Mod",
    media: {
      screenshot: [
        { purpose: "hero", url: "https://cdn.example/b-hero.jpg", width: 1920, height: 1080 },
      ],
    },
  },
};

const GAME_C: LibraryGame = {
  provider: "steam",
  externalGameId: "999",
  name: "Void Run",
  installState: "installed",
  catalogIdentity: {
    id: "identity-3",
    name: "Void Run",
    media: {
      screenshot: [
        { purpose: "hero", url: "https://cdn.example/c-hero.jpg", width: 1920, height: 1080 },
      ],
    },
  },
};

const ACTIONS: UseGameActionsResult = {
  launch: vi.fn(),
  install: vi.fn(),
  refreshInstallStatus: vi.fn(),
  openSteamDownloads: vi.fn(),
  isLaunching: false,
  isInstalling: false,
  error: null,
  retry: vi.fn(),
};

afterEach(restoreMatchMedia);

/** The hero renders a Detalhes link, so the stage needs a router context. */
function stageElement(game: LibraryGame): ReactElement {
  return (
    <MemoryRouter>
      <HeroStage game={game} actions={ACTIONS} />
    </MemoryRouter>
  );
}

describe("HeroStage ambient motion", () => {
  it("applies the continuous ambient loop to the hero media layer only", () => {
    render(stageElement(GAME_A));

    const stage = screen.getByLabelText("Jogo em destaque");
    const media = stage.querySelector("img");
    expect(media).not.toBeNull();
    expect(media).toHaveClass("animate-ambient");
  });

  it("removes the ambient loop class when reduced motion is active", () => {
    mockMatchMedia(REDUCED_MOTION_QUERY, true);
    render(stageElement(GAME_A));

    const stage = screen.getByLabelText("Jogo em destaque");
    expect(stage.querySelector("img")).not.toHaveClass("animate-ambient");
  });

  it("animates the featured title with a copy-in class, except under reduced motion", () => {
    const { unmount } = render(stageElement(GAME_A));
    expect(
      screen.getByRole("heading", { name: "Counter-Strike 2" }),
    ).toHaveClass("animate-copy-in");
    unmount();

    mockMatchMedia(REDUCED_MOTION_QUERY, true);
    render(stageElement(GAME_A));
    expect(
      screen.getByRole("heading", { name: "Counter-Strike 2" }),
    ).not.toHaveClass("animate-copy-in");
  });
});

describe("HeroStage selection transitions", () => {
  it("keeps the previous art visible until the new media is ready", () => {
    const { rerender } = render(stageElement(GAME_A));
    const stage = screen.getByLabelText("Jogo em destaque");

    // The first media confirms once loaded.
    fireEvent.load(stage.querySelector("img[src*='a-hero']")!);

    rerender(stageElement(GAME_B));

    // While the new art is not ready, the previous art stays on stage:
    // no empty flash, no premature swap.
    expect(stage.querySelector("img[src*='a-hero']")).not.toBeNull();
    expect(stage.querySelector("img[src*='b-hero']")).not.toBeNull();

    // The pending layer is hidden until it is ready, then takes over while
    // the old layer fades out — both layers stay mounted through the fade.
    const pending = stage.querySelector("img[src*='b-hero']")!;
    expect(pending).toHaveClass("opacity-0");
    fireEvent.load(pending);

    expect(stage.querySelector("img[src*='a-hero']")).not.toBeNull();
    expect(stage.querySelector("img[src*='a-hero']")).toHaveClass("opacity-0");
    expect(stage.querySelector("img[src*='b-hero']")).not.toBeNull();
    expect(stage.querySelector("img[src*='b-hero']")).not.toHaveClass("opacity-0");

    // Once the fade completes, the outgoing layer is released.
    fireEvent.transitionEnd(stage.querySelector("img[src*='a-hero']")!);
    expect(stage.querySelector("img[src*='a-hero']")).toBeNull();
    expect(stage.querySelector("img[src*='b-hero']")).not.toBeNull();
  });

  it("keeps the outgoing layer mounted and fading while the new layer fades in", () => {
    const { rerender } = render(stageElement(GAME_A));
    const stage = screen.getByLabelText("Jogo em destaque");
    fireEvent.load(stage.querySelector("img[src*='a-hero']")!);

    rerender(stageElement(GAME_B));
    fireEvent.load(stage.querySelector("img[src*='b-hero']")!);

    // Fade-through, not fade-through-dark: at the start of the swap both
    // layers are on stage — the old one dimming, the new one emerging — so
    // the dark stage background never shows through the transition.
    expect(stage.querySelector("img[src*='a-hero']")).not.toBeNull();
    expect(stage.querySelector("img[src*='a-hero']")).toHaveClass("opacity-0");
    expect(stage.querySelector("img[src*='b-hero']")).not.toHaveClass("opacity-0");

    fireEvent.transitionEnd(stage.querySelector("img[src*='a-hero']")!);
    expect(stage.querySelector("img[src*='a-hero']")).toBeNull();
    expect(stage.querySelector("img[src*='b-hero']")).not.toBeNull();
  });

  it("falls back to the derived title when the pending media errors", () => {
    const { rerender } = render(stageElement(GAME_A));
    const stage = screen.getByLabelText("Jogo em destaque");
    fireEvent.load(stage.querySelector("img[src*='a-hero']")!);

    rerender(stageElement(GAME_B));
    fireEvent.error(stage.querySelector("img[src*='b-hero']")!);

    // The stage is never blank: the media that failed is replaced by the
    // derived title composition of the featured game.
    expect(stage.querySelector("img")).toBeNull();
    expect(screen.getByRole("heading", { name: "Garry's Mod" })).toBeInTheDocument();
  });

  it("keeps the confirmed art when the featured game changes rapidly", () => {
    const { rerender } = render(stageElement(GAME_A));
    const stage = screen.getByLabelText("Jogo em destaque");
    fireEvent.load(stage.querySelector("img[src*='a-hero']")!);

    // A -> B (never loads) -> C: the confirmed A art holds the stage and the
    // half-started B layer is dropped instead of flashing.
    rerender(stageElement(GAME_B));
    rerender(stageElement(GAME_C));

    expect(stage.querySelector("img[src*='a-hero']")).not.toBeNull();
    expect(stage.querySelector("img[src*='b-hero']")).toBeNull();
    expect(stage.querySelector("img[src*='c-hero']")).not.toBeNull();
    expect(stage.querySelector("img[src*='c-hero']")).toHaveClass("opacity-0");
  });
});

describe("HeroStage media loading", () => {
  it("loads the hero media eagerly — it never defers the stage art", () => {
    render(stageElement(GAME_A));

    const stage = screen.getByLabelText("Jogo em destaque");
    expect(stage.querySelector("img")).toHaveAttribute("loading", "eager");
    expect(stage.querySelector("img")).not.toHaveAttribute("loading", "lazy");
  });
});
