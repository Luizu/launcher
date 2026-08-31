import type { LibraryGame } from "../../lib/merge-library";
import { gameKey, selectFeaturedGame } from "./select-featured-game";

const CS2: LibraryGame = {
  provider: "steam",
  externalGameId: "730",
  name: "Counter-Strike 2",
  installState: "not-installed",
  lastActivityAt: "2026-08-28T10:00:00.000Z",
};

const DOTA: LibraryGame = {
  provider: "steam",
  externalGameId: "570",
  name: "Dota 2",
  installState: "installed",
  lastActivityAt: "2026-08-28T09:00:00.000Z",
};

const GARRY: LibraryGame = {
  provider: "steam",
  externalGameId: "4000",
  name: "Garry's Mod",
  installState: "installed",
  lastActivityAt: null,
};

const PORTAL: LibraryGame = {
  provider: "steam",
  externalGameId: "400",
  name: "Portal",
  installState: "installed",
};

const HALF_LIFE: LibraryGame = {
  provider: "steam",
  externalGameId: "70",
  name: "Half-Life",
  installState: "installed",
};

describe("selectFeaturedGame", () => {
  it("returns null for an empty library", () => {
    expect(selectFeaturedGame([])).toBeNull();
  });

  it("prefers the entry with the latest remote activity over any other ranking", () => {
    // CS2 is not installed: the featured game must still be actionable, and
    // INSTALAR is the explicit action for a known not-installed entry.
    expect(selectFeaturedGame([DOTA, CS2, GARRY])).toBe(CS2);
  });

  it("lets remote activity beat local history (ticket 06 rule direction)", () => {
    const history = {
      [gameKey(GARRY)]: "2026-08-29T00:00:00.000Z",
      [gameKey(PORTAL)]: "2026-08-28T00:00:00.000Z",
    };
    expect(selectFeaturedGame([GARRY, PORTAL, CS2], { history })).toBe(CS2);
  });

  it("uses local history when no remote activity exists", () => {
    const history = {
      [gameKey(GARRY)]: "2026-08-27T00:00:00.000Z",
      [gameKey(PORTAL)]: "2026-08-26T00:00:00.000Z",
    };
    expect(selectFeaturedGame([GARRY, PORTAL], { history })).toBe(GARRY);
  });

  it("lets history beat pinned and the stable installed order", () => {
    const history = { [gameKey(HALF_LIFE)]: "2026-08-25T00:00:00.000Z" };
    const pinned = [gameKey(PORTAL)];
    expect(selectFeaturedGame([PORTAL, HALF_LIFE], { history, pinned })).toBe(
      HALF_LIFE,
    );
  });

  it("prefers a pinned entry over the stable installed order", () => {
    const pinned = [gameKey(PORTAL), gameKey(GARRY)];
    expect(selectFeaturedGame([GARRY, PORTAL], { pinned })).toBe(PORTAL);
  });

  it("falls back to the stable installed order (by name) when nothing ranks higher", () => {
    expect(selectFeaturedGame([PORTAL, HALF_LIFE, GARRY])).toBe(GARRY);
  });

  it("breaks activity ties deterministically by name, then provider", () => {
    const twinA: LibraryGame = {
      ...DOTA,
      provider: "epic",
      externalGameId: "1",
      lastActivityAt: "2026-08-28T09:00:00.000Z",
    };
    const twinB: LibraryGame = {
      ...DOTA,
      externalGameId: "570",
      lastActivityAt: "2026-08-28T09:00:00.000Z",
    };
    // Same activity and same name: the provider string decides ("epic" < "steam").
    expect(selectFeaturedGame([twinB, twinA])).toBe(twinA);
  });

  it("never drops entries that have no activity", () => {
    // No activity anywhere, no history: the installed entries still rank by
    // stable order instead of disappearing from the Home.
    const result = selectFeaturedGame([PORTAL, HALF_LIFE]);
    expect(result).toBe(HALF_LIFE);
  });

  it("ignores history and pinned keys for games outside the library", () => {
    const history = { "steam:999999": "2026-08-29T00:00:00.000Z" };
    const pinned = ["steam:888888"];
    expect(selectFeaturedGame([PORTAL, HALF_LIFE], { history, pinned })).toBe(
      HALF_LIFE,
    );
  });

  it("returns null when only not-installed entries without activity remain", () => {
    expect(selectFeaturedGame([{ ...CS2, lastActivityAt: null }])).toBeNull();
  });

  it("exposes the game key used by the history and pinned seams", () => {
    expect(gameKey({ provider: "steam", externalGameId: "730" })).toBe(
      "steam:730",
    );
  });
});
