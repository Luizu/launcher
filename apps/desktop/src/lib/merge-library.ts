import type {
  EnrichmentStatus,
  GameCatalogIdentity,
  GameLibraryResponse,
  LocalGame,
  LocalLibrarySnapshot,
  PlatformId,
} from "@fuse-launcher/contracts";

/**
 * Installation vocabulary the UI and Task 6 actions consume. Derived from the
 * local snapshot: `installed` → `installed`, `installing` → `installing`,
 * `unknown` → `unknown`; absent from the local snapshot → `not-installed`.
 */
export type InstallState =
  | "installed"
  | "not-installed"
  | "installing"
  | "unknown";

/**
 * One displayable library game after the remote library is merged with the
 * local snapshot. Ids are normalized to decimal strings so actions can
 * convert them back to numbers safely; the remote entry is the display
 * source for name, artwork, and playtime when present.
 */
export interface LibraryGame {
  provider: PlatformId;
  externalGameId: string;
  name: string;
  /** Provider synopsis used by the Home when catalog description is absent. */
  description?: string | null;
  artwork?: string | null;
  /** Canonical provider total in minutes; null means the provider had no value. */
  playtimeTotalMinutes?: number | null;
  /** Rolling provider window in minutes, normally the last 14 days. */
  playtimeRecent14dMinutes?: number | null;
  /** @deprecated Compatibility alias for playtimeTotalMinutes. */
  playtimeMinutes?: number;
  installState: InstallState;
  /**
   * Last known remote activity instant as an ISO string; absent for
   * local-only games (the provider never saw them).
   */
  lastActivityAt?: string | null;
  /** Canonical provider activity instant. */
  remoteLastPlayedAt?: string | null;
  /** Catalog enrichment state carried from the remote entry. */
  enrichmentStatus?: EnrichmentStatus;
  /** Catalog identity (name, description, media) carried from the remote
   * entry; absent for local-only games. */
  catalogIdentity?: GameCatalogIdentity | null;
}

/** Maps the native snapshot state onto the merged vocabulary. */
const LOCAL_STATE_TO_INSTALL: Record<LocalGame["state"], InstallState> = {
  installed: "installed",
  installing: "installing",
  unknown: "unknown",
};

/** Normalizes a provider id (string or number) to a decimal string. */
function normalizeId(id: string | number): string {
  if (typeof id === "number") return String(id);
  const trimmed = id.trim();
  return /^\d+$/.test(trimmed) ? String(Number(trimmed)) : trimmed;
}

function joinKey(provider: PlatformId, externalGameId: string | number): string {
  return `${provider}:${normalizeId(externalGameId)}`;
}

/**
 * Merges the remote library with the local Steam snapshot into a single
 * display list, joining on `provider + ":" + externalGameId` with both ids
 * normalized to decimal strings.
 *
 * Local state wins for installation status; the remote entry is the display
 * source for name, artwork, and playtime. Local-only games (installed on this
 * machine but absent from the remote list) are kept with their local state so
 * they stay launchable when the remote library is stale or unreachable. In
 * the page, that surfaces through the partial-error path: when the remote
 * query errors, the local snapshot still renders with a retry banner. A null
 * connection is handled defensively here, but the page never merges in that
 * state — when not connected it shows the connect action instead (the plan's
 * "not connected → connect action" state). When the remote connection exists
 * but the library is explicitly private or unavailable (visibility
 * `private`/`unavailable`), the remote side is deliberately empty so the page
 * can explain the state instead of showing a misleading list. A failed sync
 * with public visibility keeps the last valid snapshot: the entries are stale
 * but present, and the page shows them alongside the failed status.
 */
export function mergeLibrary(
  remote: GameLibraryResponse,
  local: LocalLibrarySnapshot,
): LibraryGame[] {
  const connection = remote.connection;
  if (
    connection !== null &&
    (connection.visibility === "private" ||
      connection.visibility === "unavailable")
  ) {
    return [];
  }

  const localByKey = new Map<string, LocalGame>();
  for (const game of local.games) {
    localByKey.set(joinKey(game.provider, game.externalGameId), game);
  }

  const merged: LibraryGame[] = [];
  const seen = new Set<string>();

  for (const entry of remote.entries) {
    const key = joinKey(entry.provider, entry.externalGameId);
    if (seen.has(key)) continue;
    seen.add(key);
    const localGame = localByKey.get(key);
    merged.push({
      provider: entry.provider,
      externalGameId: normalizeId(entry.externalGameId),
      name: entry.name,
      description: entry.description,
      artwork: entry.artwork,
      playtimeTotalMinutes: entry.playtimeTotalMinutes,
      playtimeRecent14dMinutes: entry.playtimeRecent14dMinutes,
      playtimeMinutes: entry.playtimeMinutes,
      installState: localGame
        ? LOCAL_STATE_TO_INSTALL[localGame.state]
        : "not-installed",
      lastActivityAt: entry.lastActivityAt,
      remoteLastPlayedAt: entry.remoteLastPlayedAt,
      enrichmentStatus: entry.enrichmentStatus,
      catalogIdentity: entry.catalogIdentity,
    });
  }

  for (const game of local.games) {
    const key = joinKey(game.provider, game.externalGameId);
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push({
      provider: game.provider,
      externalGameId: normalizeId(game.externalGameId),
      name: game.name,
      installState: LOCAL_STATE_TO_INSTALL[game.state],
    });
  }

  return merged;
}
