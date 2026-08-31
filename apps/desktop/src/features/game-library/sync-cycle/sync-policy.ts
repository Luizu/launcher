import type { GameLibraryConnection } from "@fuse-launcher/contracts";

/**
 * A connection is stale — eligible for a focus/periodic sync — when it never
 * synced, its last sync is older than `staleMs`, or the last sync failed.
 * A sync in progress is only spared while its last sync is recent: a
 * connection persisted as `syncing` with no sync (or one older than the
 * staleness window) is stuck — a previous session died mid-sync — and counts
 * as stale so the cycle recovers it automatically. The policy reads only
 * connection fields; per-game catalog enrichment status never influences it.
 */
export function isSyncStale(
  connection: GameLibraryConnection,
  staleMs: number,
  now: number,
): boolean {
  if (connection.syncStatus === "failed") return true;
  if (connection.lastSyncedAt == null) return true;
  const last = Date.parse(connection.lastSyncedAt);
  if (Number.isNaN(last)) return true;
  // `syncing` deliberately falls through: with a recent last sync it stays
  // not-stale (a live sync in progress is never retried); with an old one
  // it is stuck and counts as stale.
  return now - last >= staleMs;
}

/** A connection is considered stale after this idle window (15 minutes). */
export const SYNC_STALE_MS = 15 * 60 * 1000;

/** Periodic re-evaluation cadence while the app is open (5 minutes). */
export const SYNC_INTERVAL_MS = 5 * 60 * 1000;
