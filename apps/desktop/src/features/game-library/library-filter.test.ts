import type { LibraryGame } from "../../lib/merge-library";
import {
  displayedTitle,
  filterGames,
  libraryProviders,
  sortGames,
} from "./library-filter";

function game(overrides: Partial<LibraryGame>): LibraryGame {
  return {
    provider: "steam",
    externalGameId: "1",
    name: "Game",
    installState: "not-installed",
    ...overrides,
  };
}

describe("displayedTitle", () => {
  it("prefers the catalog identity name", () => {
    expect(
      displayedTitle(
        game({
          name: "portal2app",
          catalogIdentity: { id: "identity-1", name: "Portal 2", media: {} },
        }),
      ),
    ).toBe("Portal 2");
  });

  it("falls back to the entry name without catalog identity", () => {
    expect(displayedTitle(game({ name: "Fallout" }))).toBe("Fallout");
  });
});

describe("libraryProviders", () => {
  it("returns unique providers in first-appearance order", () => {
    const games = [
      game({ provider: "steam" }),
      game({ provider: "epic", externalGameId: "2" }),
      game({ provider: "steam", externalGameId: "3" }),
    ];
    expect(libraryProviders(games)).toEqual(["steam", "epic"]);
  });
});

describe("filterGames", () => {
  const games = [
    game({ externalGameId: "1", name: "Counter-Strike 2" }),
    game({ externalGameId: "2", name: "Portal" }),
    game({
      externalGameId: "3",
      name: "Portal 2",
      provider: "epic",
      installState: "installed",
    }),
  ];

  it("matches titles without differentiating case", () => {
    expect(
      filterGames(games, {
        query: "cOuNtEr",
        installedOnly: false,
        provider: "all",
      }).map((candidate) => candidate.externalGameId),
    ).toEqual(["1"]);
  });

  it("trims the query and returns everything for an empty query", () => {
    expect(
      filterGames(games, {
        query: "   ",
        installedOnly: false,
        provider: "all",
      }),
    ).toHaveLength(3);
  });

  it("filters installed games", () => {
    expect(
      filterGames(games, { query: "", installedOnly: true, provider: "all" }).map(
        (candidate) => candidate.externalGameId,
      ),
    ).toEqual(["3"]);
  });

  it("filters by provider", () => {
    expect(
      filterGames(games, { query: "", installedOnly: false, provider: "epic" }).map(
        (candidate) => candidate.externalGameId,
      ),
    ).toEqual(["3"]);
  });

  it("combines query, installed, and provider with AND", () => {
    const combined = [
      game({ externalGameId: "1", name: "Portal" }),
      game({
        externalGameId: "2",
        name: "Portal",
        provider: "epic",
        installState: "installed",
      }),
      game({
        externalGameId: "3",
        name: "Portal 2",
        provider: "epic",
        installState: "installed",
      }),
    ];
    expect(
      filterGames(combined, {
        query: "portal",
        installedOnly: true,
        provider: "epic",
      }).map((candidate) => candidate.externalGameId),
    ).toEqual(["2", "3"]);
  });

  it("matches the catalog identity name when enriched", () => {
    const enriched = game({
      externalGameId: "9",
      name: "portal2app",
      catalogIdentity: { id: "identity-1", name: "Portal 2", media: {} },
    });
    expect(
      filterGames([enriched], {
        query: "portal 2",
        installedOnly: false,
        provider: "all",
      }),
    ).toHaveLength(1);
  });

  it("does not mutate the input", () => {
    const before = games.map((candidate) => candidate.externalGameId);
    filterGames(games, {
      query: "portal",
      installedOnly: true,
      provider: "epic",
    });
    expect(games.map((candidate) => candidate.externalGameId)).toEqual(before);
  });
});

describe("sortGames", () => {
  it("keeps the merged order for the default key and returns a copy", () => {
    const games = [game({ externalGameId: "2" }), game({ externalGameId: "1" })];
    const sorted = sortGames(games, "default");
    expect(sorted).not.toBe(games);
    expect(sorted.map((candidate) => candidate.externalGameId)).toEqual([
      "2",
      "1",
    ]);
  });

  it("sorts titles with pt-aware ordering", () => {
    const games = [
      game({ externalGameId: "1", name: "Zebra" }),
      game({ externalGameId: "2", name: "Bacana" }),
      game({ externalGameId: "3", name: "Água" }),
      game({ externalGameId: "4", name: "aorta" }),
    ];
    expect(sortGames(games, "title").map((candidate) => candidate.name)).toEqual([
      "Água",
      "aorta",
      "Bacana",
      "Zebra",
    ]);
  });

  it("breaks title ties deterministically by provider key", () => {
    const games = [
      game({ provider: "steam", externalGameId: "1", name: "Portal" }),
      game({ provider: "epic", externalGameId: "1", name: "Portal" }),
    ];
    expect(sortGames(games, "title").map((candidate) => candidate.provider)).toEqual([
      "epic",
      "steam",
    ]);
  });

  it("sorts by recent activity descending with missing values last", () => {
    const games = [
      game({ externalGameId: "1", name: "Old", lastActivityAt: "2026-08-01T00:00:00.000Z" }),
      game({ externalGameId: "2", name: "Recent", lastActivityAt: "2026-08-20T00:00:00.000Z" }),
      game({ externalGameId: "3", name: "Never" }),
    ];
    expect(sortGames(games, "activity").map((candidate) => candidate.externalGameId)).toEqual([
      "2",
      "1",
      "3",
    ]);
  });

  it("treats an unparsable activity date as missing", () => {
    const games = [
      game({ externalGameId: "1", name: "Broken", lastActivityAt: "not-a-date" }),
      game({ externalGameId: "2", name: "Real", lastActivityAt: "2026-08-20T00:00:00.000Z" }),
    ];
    expect(sortGames(games, "activity").map((candidate) => candidate.externalGameId)).toEqual([
      "2",
      "1",
    ]);
  });

  it("breaks activity ties by name when both are missing", () => {
    const games = [
      game({ externalGameId: "1", name: "Zulu" }),
      game({ externalGameId: "2", name: "Alpha" }),
    ];
    expect(sortGames(games, "activity").map((candidate) => candidate.externalGameId)).toEqual([
      "2",
      "1",
    ]);
  });

  it("sorts by playtime descending with missing playtime treated as zero", () => {
    const games = [
      game({ externalGameId: "1", name: "Alpha", playtimeMinutes: 120 }),
      game({ externalGameId: "2", name: "Beta" }),
      game({ externalGameId: "3", name: "Gamma", playtimeMinutes: 60 }),
      game({ externalGameId: "4", name: "Delta" }),
    ];
    expect(sortGames(games, "playtime").map((candidate) => candidate.externalGameId)).toEqual([
      "1",
      "3",
      "2",
      "4",
    ]);
  });
});
