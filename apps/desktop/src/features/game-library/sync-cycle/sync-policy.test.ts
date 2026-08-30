import { describe, expect, it } from "vitest";

import { isSyncStale, SYNC_STALE_MS } from "./sync-policy";
import type { GameLibraryConnection } from "@launcher/contracts";

const NOW = Date.parse("2026-08-29T12:00:00.000Z");
const STALE_MS = 15 * 60 * 1000; // 15 minutes
const OLD = new Date(NOW - 9 * 60 * 60 * 1000).toISOString(); // 9 hours ago
const FRESH = new Date(NOW - 60 * 1000).toISOString(); // 1 minute ago

function connection(
  overrides: Partial<GameLibraryConnection> & {
    syncStatus: GameLibraryConnection["syncStatus"];
  },
): GameLibraryConnection {
  return { provider: "steam", visibility: "public", ...overrides };
}

describe("isSyncStale", () => {
  it("is stale when never synced", () => {
    expect(
      isSyncStale(connection({ syncStatus: "never", lastSyncedAt: null }), STALE_MS, NOW),
    ).toBe(true);
  });

  it("is stale when the last sync failed", () => {
    expect(
      isSyncStale(connection({ syncStatus: "failed", lastSyncedAt: FRESH }), STALE_MS, NOW),
    ).toBe(true);
  });

  it("is not stale when synced recently", () => {
    expect(
      isSyncStale(connection({ syncStatus: "synced", lastSyncedAt: FRESH }), STALE_MS, NOW),
    ).toBe(false);
  });

  it("is stale when synced longer ago than the window", () => {
    expect(
      isSyncStale(connection({ syncStatus: "synced", lastSyncedAt: OLD }), STALE_MS, NOW),
    ).toBe(true);
  });

  it("is stale when the last sync timestamp is unparseable", () => {
    expect(
      isSyncStale(connection({ syncStatus: "synced", lastSyncedAt: "not-a-date" }), STALE_MS, NOW),
    ).toBe(true);
  });

  it("is stale when syncing and never synced (stuck before first sync)", () => {
    expect(
      isSyncStale(connection({ syncStatus: "syncing", lastSyncedAt: null }), STALE_MS, NOW),
    ).toBe(true);
  });

  it("is stale when syncing and the last sync is older than the window (stuck mid-sync)", () => {
    expect(
      isSyncStale(connection({ syncStatus: "syncing", lastSyncedAt: OLD }), STALE_MS, NOW),
    ).toBe(true);
  });

  it("is not stale while syncing with a recent last sync (a live sync in progress)", () => {
    expect(
      isSyncStale(connection({ syncStatus: "syncing", lastSyncedAt: FRESH }), STALE_MS, NOW),
    ).toBe(false);
  });

  it("exports the 15-minute staleness window", () => {
    expect(SYNC_STALE_MS).toBe(15 * 60 * 1000);
  });
});
