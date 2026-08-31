import type { GameCatalogIdentity } from "@fuse-launcher/contracts";
import {
  selectGamePageMedia,
  selectHeroMedia,
  selectSelectorCover,
} from "../../lib/media-fallback";

const HERO_SCREENSHOT = {
  purpose: "hero",
  url: "https://cdn.example/hero.jpg",
  width: 1920,
  height: 1080,
} as const;

const HERO_ARTWORK = {
  purpose: "hero",
  url: "https://cdn.example/hero-art.jpg",
  width: 1920,
  height: 1080,
} as const;

const GAME_PAGE = {
  purpose: "game-page",
  url: "https://cdn.example/game-page.jpg",
  width: 1280,
  height: 720,
} as const;

/** A game-page cover variant, used when the selector purpose is missing. */
const COVER_GAME_PAGE = {
  purpose: "game-page",
  url: "https://cdn.example/game-page-cover.jpg",
  width: 460,
  height: 215,
} as const;

/** A cover-group tile with the selector purpose (the group fallback). */
const COVER_SELECTOR = {
  purpose: "selector",
  url: "https://cdn.example/cover.jpg",
  width: 460,
  height: 215,
} as const;

const SELECTOR = {
  purpose: "selector",
  url: "https://cdn.example/selector.jpg",
  width: 460,
  height: 215,
} as const;

function identity(
  media: GameCatalogIdentity["media"],
): GameCatalogIdentity {
  return { id: "identity-1", name: "SpellBrook", media };
}

describe("selectHeroMedia", () => {
  it("picks the largest hero variant (the 2x screenshot) when both densities exist", () => {
    const result = selectHeroMedia(
      identity({
        screenshot: [
          {
            purpose: "hero",
            url: "https://cdn.example/hero-1x.jpg",
            width: 1280,
            height: 720,
          },
          {
            purpose: "hero",
            url: "https://cdn.example/hero-2x.jpg",
            width: 2560,
            height: 1440,
          },
        ],
      }),
    );
    expect(result).toBe("https://cdn.example/hero-2x.jpg");
  });

  it("keeps the group scan order for same-width hero variants", () => {
    const result = selectHeroMedia(
      identity({
        screenshot: [
          {
            purpose: "hero",
            url: "https://cdn.example/screenshot-hero.jpg",
            width: 2560,
            height: 1440,
          },
        ],
        artwork: [
          {
            purpose: "hero",
            url: "https://cdn.example/artwork-hero.jpg",
            width: 2560,
            height: 1440,
          },
        ],
      }),
    );
    // Both groups offer a 2560 hero; the earlier group wins the tie.
    expect(result).toBe("https://cdn.example/screenshot-hero.jpg");
  });

  it("prefers the catalog hero variant over any other purpose", () => {
    const result = selectHeroMedia(
      identity({
        artwork: [GAME_PAGE],
        cover: [SELECTOR, COVER_SELECTOR],
        screenshot: [HERO_SCREENSHOT],
      }),
      "https://cdn.example/provider.jpg",
    );
    expect(result).toBe("https://cdn.example/hero.jpg");
  });

  it("accepts a hero variant from the artwork group (screenshot_huge or artwork)", () => {
    const result = selectHeroMedia(
      identity({ artwork: [HERO_ARTWORK] }),
      "https://cdn.example/provider.jpg",
    );
    expect(result).toBe("https://cdn.example/hero-art.jpg");
  });

  it("falls back to the game-page variant when no hero variant exists", () => {
    const result = selectHeroMedia(identity({ artwork: [GAME_PAGE] }));
    expect(result).toBe("https://cdn.example/game-page.jpg");
  });

  it("falls back to a cover-group variant when neither hero nor game-page exists", () => {
    const result = selectHeroMedia(identity({ cover: [COVER_SELECTOR] }));
    expect(result).toBe("https://cdn.example/cover.jpg");
  });

  it("falls back to the provider artwork when the catalog has no media", () => {
    expect(
      selectHeroMedia(identity({}), "https://cdn.example/provider.jpg"),
    ).toBe("https://cdn.example/provider.jpg");
  });

  it("falls back to the provider artwork when the catalog identity is missing", () => {
    expect(selectHeroMedia(null, "https://cdn.example/provider.jpg")).toBe(
      "https://cdn.example/provider.jpg",
    );
  });

  it("returns null when nothing is available (derived title fallback)", () => {
    expect(selectHeroMedia(null, null)).toBeNull();
    expect(selectHeroMedia(identity({}), undefined)).toBeNull();
  });
});

describe("selectGamePageMedia", () => {
  it("picks the largest game-page variant (1080p 2x) when both densities exist", () => {
    const result = selectGamePageMedia(
      identity({
        screenshot: [
          {
            purpose: "game-page",
            url: "https://cdn.example/page-1x.jpg",
            width: 1920,
            height: 1080,
          },
          {
            purpose: "game-page",
            url: "https://cdn.example/page-2x.jpg",
            width: 3840,
            height: 2160,
          },
        ],
      }),
    );
    expect(result).toBe("https://cdn.example/page-2x.jpg");
  });

  it("prefers the game-page variant for the page", () => {
    const result = selectGamePageMedia(
      identity({
        screenshot: [HERO_SCREENSHOT, GAME_PAGE],
        cover: [SELECTOR],
      }),
    );
    expect(result).toBe("https://cdn.example/game-page.jpg");
  });

  it("falls back to the hero variant when no game-page variant exists", () => {
    const result = selectGamePageMedia(identity({ screenshot: [HERO_SCREENSHOT] }));
    expect(result).toBe("https://cdn.example/hero.jpg");
  });

  it("falls back to a cover-group variant when only covers exist", () => {
    const result = selectGamePageMedia(identity({ cover: [SELECTOR] }));
    expect(result).toBe("https://cdn.example/selector.jpg");
  });

  it("returns null without a catalog identity or media (derived fallback)", () => {
    expect(selectGamePageMedia(null)).toBeNull();
    expect(selectGamePageMedia(identity({}))).toBeNull();
  });
});

describe("selectSelectorCover", () => {
  it("picks the largest selector variant (cover_big) when both densities exist", () => {
    const result = selectSelectorCover(
      identity({
        cover: [
          {
            purpose: "selector",
            url: "https://cdn.example/cover-small.jpg",
            width: 90,
            height: 128,
          },
          {
            purpose: "selector",
            url: "https://cdn.example/cover-big.jpg",
            width: 264,
            height: 374,
          },
        ],
      }),
    );
    expect(result).toBe("https://cdn.example/cover-big.jpg");
  });

  it("prefers the selector variant for the selector row", () => {
    const result = selectSelectorCover(
      identity({ cover: [COVER_GAME_PAGE, SELECTOR] }),
      "https://cdn.example/provider.jpg",
    );
    expect(result).toBe("https://cdn.example/selector.jpg");
  });

  it("falls back to a cover-group variant when no selector variant exists", () => {
    const result = selectSelectorCover(identity({ cover: [COVER_GAME_PAGE] }));
    expect(result).toBe("https://cdn.example/game-page-cover.jpg");
  });

  it("falls back to the provider artwork when the catalog is unavailable", () => {
    expect(selectSelectorCover(null, "https://cdn.example/provider.jpg")).toBe(
      "https://cdn.example/provider.jpg",
    );
  });
});
