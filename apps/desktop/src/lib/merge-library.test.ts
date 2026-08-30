import type {
  GameLibraryConnection,
  GameLibraryResponse,
  LocalLibrarySnapshot,
} from "@launcher/contracts";
import { mergeLibrary } from "./merge-library";

const SYNCED_PUBLIC: GameLibraryConnection = {
  provider: "steam",
  visibility: "public",
  syncStatus: "synced",
  lastSyncedAt: "2026-08-28T00:00:00.000Z",
};

const COUNTER_STRIKE = {
  provider: "steam",
  externalGameId: "730",
  name: "Counter-Strike 2",
  enrichmentStatus: "pending",
  catalogIdentity: null,
} as const;

function remote(overrides: Partial<GameLibraryResponse> = {}): GameLibraryResponse {
  return { connection: SYNCED_PUBLIC, entries: [], ...overrides };
}

function local(games: LocalLibrarySnapshot["games"] = []): LocalLibrarySnapshot {
  return { games, diagnostics: [] };
}

it("marks a remote game as installed when the local snapshot has the same provider and id", () => {
  const result = mergeLibrary(
    {
      connection: { provider: "steam", visibility: "public", syncStatus: "synced" },
      entries: [{ provider: "steam", externalGameId: "730", name: "Counter-Strike 2", enrichmentStatus: "pending", catalogIdentity: null }],
    },
    {
      games: [{ provider: "steam", externalGameId: 730, name: "Counter-Strike 2", state: "installed" }],
      diagnostics: [],
    },
  );

  expect(result[0]).toMatchObject({ installState: "installed" });
});

it("keeps a public remote game as installable when it is not local", () => {
  const result = mergeLibrary(
    {
      connection: { provider: "steam", visibility: "public", syncStatus: "synced" },
      entries: [{ provider: "steam", externalGameId: "730", name: "Counter-Strike 2", enrichmentStatus: "pending", catalogIdentity: null }],
    },
    { games: [], diagnostics: [] },
  );

  expect(result[0].installState).toBe("not-installed");
});

it("joins a remote string id with a local numeric id", () => {
  const result = mergeLibrary(
    remote({ entries: [COUNTER_STRIKE] }),
    local([{ provider: "steam", externalGameId: 730, name: "csgo", state: "installed" }]),
  );

  expect(result).toHaveLength(1);
  expect(result[0]).toMatchObject({ externalGameId: "730", installState: "installed" });
});

it("normalizes both ids to decimal strings before joining", () => {
  const result = mergeLibrary(
    remote({ entries: [{ provider: "steam", externalGameId: "00730", name: "Counter-Strike 2", enrichmentStatus: "pending", catalogIdentity: null }] }),
    local([{ provider: "steam", externalGameId: 730, name: "csgo", state: "installed" }]),
  );

  expect(result).toHaveLength(1);
  expect(result[0].externalGameId).toBe("730");
});

it("returns an empty list when the remote connection is private", () => {
  const result = mergeLibrary(
    {
      connection: { provider: "steam", visibility: "private", syncStatus: "synced", lastSyncedAt: null },
      entries: [COUNTER_STRIKE],
    },
    local([{ provider: "steam", externalGameId: 730, name: "csgo", state: "installed" }]),
  );

  expect(result).toEqual([]);
});

it("returns an empty list when the remote connection is unavailable", () => {
  const result = mergeLibrary(
    {
      connection: { provider: "steam", visibility: "unavailable", syncStatus: "failed", lastSyncedAt: null },
      entries: [COUNTER_STRIKE],
    },
    local(),
  );

  expect(result).toEqual([]);
});

it("keeps remote entries when the last sync failed (stale but present)", () => {
  const result = mergeLibrary(
    {
      connection: { provider: "steam", visibility: "public", syncStatus: "failed", lastSyncedAt: null },
      entries: [COUNTER_STRIKE],
    },
    local(),
  );

  expect(result).toEqual([
    expect.objectContaining({ externalGameId: "730", installState: "not-installed" }),
  ]);
});

it("merges local-only games with stale remote entries after a failed sync", () => {
  const result = mergeLibrary(
    {
      connection: { provider: "steam", visibility: "public", syncStatus: "failed", lastSyncedAt: null },
      entries: [COUNTER_STRIKE],
    },
    local([{ provider: "steam", externalGameId: 4000, name: "Garry's Mod", state: "installed" }]),
  );

  expect(result).toHaveLength(2);
  expect(result[0]).toMatchObject({ externalGameId: "730", installState: "not-installed" });
  expect(result[1]).toMatchObject({ externalGameId: "4000", installState: "installed" });
});

it("includes local-only games with their local install state", () => {
  const result = mergeLibrary(
    remote(),
    local([{ provider: "steam", externalGameId: 4000, name: "Garry's Mod", state: "installed" }]),
  );

  expect(result).toHaveLength(1);
  expect(result[0]).toMatchObject({
    provider: "steam",
    externalGameId: "4000",
    name: "Garry's Mod",
    installState: "installed",
  });
});

it("keeps local-only games when there is no remote connection", () => {
  const result = mergeLibrary(
    { connection: null, entries: [] },
    local([{ provider: "steam", externalGameId: 4000, name: "Garry's Mod", state: "installed" }]),
  );

  expect(result).toHaveLength(1);
  expect(result[0].installState).toBe("installed");
});

it("does not duplicate games when the remote repeats an id", () => {
  const result = mergeLibrary(
    remote({ entries: [COUNTER_STRIKE, COUNTER_STRIKE] }),
    local(),
  );

  expect(result).toHaveLength(1);
});

it("uses the remote name, artwork, and playtime as the display source", () => {
  const result = mergeLibrary(
    remote({
      entries: [
        {
          provider: "steam",
          externalGameId: "730",
          name: "Counter-Strike 2",
          artwork: "https://cdn.example/730.jpg",
          playtimeMinutes: 1234,
          enrichmentStatus: "pending",
          catalogIdentity: null,
        },
      ],
    }),
    local([{ provider: "steam", externalGameId: 730, name: "csgo", state: "installed" }]),
  );

  expect(result[0]).toMatchObject({
    name: "Counter-Strike 2",
    artwork: "https://cdn.example/730.jpg",
    playtimeMinutes: 1234,
    installState: "installed",
  });
});

it("maps local installing and unknown states onto the merged game", () => {
  const installing = mergeLibrary(
    remote({ entries: [COUNTER_STRIKE] }),
    local([{ provider: "steam", externalGameId: 730, name: "csgo", state: "installing" }]),
  );
  expect(installing[0].installState).toBe("installing");

  const unknown = mergeLibrary(
    remote({ entries: [COUNTER_STRIKE] }),
    local([{ provider: "steam", externalGameId: 730, name: "csgo", state: "unknown" }]),
  );
  expect(unknown[0].installState).toBe("unknown");
});

it("carries catalog identity, enrichment status, and last activity from the remote entry", () => {
  const result = mergeLibrary(
    remote({
      entries: [
        {
          provider: "steam",
          externalGameId: "730",
          name: "Counter-Strike 2",
          lastActivityAt: "2026-08-28T10:00:00.000Z",
          enrichmentStatus: "enriched",
          catalogIdentity: {
            id: "identity-1",
            name: "Counter-Strike 2",
            media: {
              cover: [
                { purpose: "selector", url: "https://cdn.example/730.jpg", width: 460, height: 215 },
              ],
            },
          },
        },
      ],
    }),
    local([{ provider: "steam", externalGameId: 730, name: "csgo", state: "installed" }]),
  );

  expect(result[0]).toMatchObject({
    lastActivityAt: "2026-08-28T10:00:00.000Z",
    enrichmentStatus: "enriched",
    catalogIdentity: { id: "identity-1", name: "Counter-Strike 2" },
  });
});

it("leaves local-only games without remote catalog or activity data", () => {
  const result = mergeLibrary(
    remote(),
    local([{ provider: "steam", externalGameId: 4000, name: "Garry's Mod", state: "installed" }]),
  );

  expect(result[0]).toMatchObject({ name: "Garry's Mod", installState: "installed" });
  expect(result[0].lastActivityAt).toBeUndefined();
  expect(result[0].enrichmentStatus).toBeUndefined();
  expect(result[0].catalogIdentity).toBeUndefined();
});
