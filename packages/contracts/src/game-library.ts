import type { PlatformId } from "./platform-connections";

export type PlatformVisibility =
  | "public"
  | "private"
  | "unavailable"
  | "unknown";

export type PlatformSyncStatus = "never" | "syncing" | "synced" | "failed";

export interface ExternalAccountRef {
  provider: PlatformId;
  externalAccountId: string;
}

export interface ExternalGame {
  provider: PlatformId;
  externalGameId: string;
  name: string;
  /** Provider synopsis used when catalog enrichment has no description yet. */
  description?: string | null;
  /** Canonical provider total; Steam sends this value in minutes. */
  playtimeTotalMinutes?: number | null;
  /** Provider's rolling recent window; Steam currently reports 14 days. */
  playtimeRecent14dMinutes?: number | null;
  /** @deprecated Compatibility alias for playtimeTotalMinutes. */
  playtimeMinutes?: number;
  artwork?: string;
  /** Last known remote activity instant; null when the provider never saw any. */
  lastActivityAt?: Date | null;
  /** Canonical provider activity field. */
  remoteLastPlayedAt?: Date | null;
}

export interface ExternalAchievementDefinition {
  apiName: string;
  displayName: string;
  description?: string | null;
  iconUrl?: string | null;
  iconGrayUrl?: string | null;
  hidden?: boolean;
}

export interface ExternalAchievementProgress {
  apiName: string;
  achieved: boolean;
  unlockedAt?: Date | null;
}

/** Catalog enrichment state, independent of the provider sync status. */
export type EnrichmentStatus = "pending" | "enriched" | "unmatched" | "failed";

/** Where a media variant is displayed in the desktop. */
export type MediaPurpose = "selector" | "hero" | "game-page";

export interface MediaVariant {
  purpose: MediaPurpose;
  url: string;
  width: number;
  height: number;
}

export interface CatalogIdentityMedia {
  cover?: MediaVariant[];
  artwork?: MediaVariant[];
  screenshot?: MediaVariant[];
}

export interface AchievementSummary {
  achieved: number;
  total: number;
  /** Instant at which the provider progress was observed. */
  fetchedAt?: string | null;
}

export interface GameAchievement {
  apiName: string;
  displayName: string;
  description?: string | null;
  iconUrl?: string | null;
  iconGrayUrl?: string | null;
  hidden: boolean;
  achieved: boolean;
  unlockedAt?: string | null;
}

export interface GameCatalogIdentity {
  /** Stable catalog identity id (the CatalogIdentity cuid); addressable. */
  id: string;
  name: string;
  description?: string | null;
  genres?: string[] | null;
  platforms?: string[] | null;
  media: CatalogIdentityMedia;
}

export interface GameLibraryEntry {
  provider: PlatformId;
  externalGameId: string;
  name: string;
  /** Provider synopsis used as the Home fallback before catalog enrichment. */
  description?: string | null;
  /** Canonical provider total in minutes. */
  playtimeTotalMinutes?: number | null;
  /** Rolling provider window in minutes, normally the last 14 days. */
  playtimeRecent14dMinutes?: number | null;
  /** @deprecated Compatibility alias for playtimeTotalMinutes. */
  playtimeMinutes?: number;
  artwork?: string | null;
  /** Last known remote activity instant as an ISO string; null when none. */
  lastActivityAt?: string | null;
  /** Canonical provider activity instant as an ISO string. */
  remoteLastPlayedAt?: string | null;
  enrichmentStatus: EnrichmentStatus;
  catalogIdentity: GameCatalogIdentity | null;
}

export interface GameLibraryConnection {
  provider: PlatformId;
  visibility: PlatformVisibility;
  syncStatus: PlatformSyncStatus;
  lastSyncedAt?: string | null;
}

export interface GameLibraryResponse {
  connection: GameLibraryConnection | null;
  entries: ReadonlyArray<GameLibraryEntry>;
}

/**
 * One of the requesting user's provider entries associated with a game page's
 * catalog identity. Possession, playtime, and actions stay per provider:
 * entries from different providers are never merged.
 */
export interface GamePageEntry {
  provider: PlatformId;
  externalGameId: string;
  name: string;
  /** Canonical provider total in minutes. */
  playtimeTotalMinutes?: number | null;
  /** Rolling provider window in minutes, normally the last 14 days. */
  playtimeRecent14dMinutes?: number | null;
  /** @deprecated Compatibility alias for playtimeTotalMinutes. */
  playtimeMinutes?: number;
  /** Last known remote activity instant as an ISO string; null when none. */
  lastActivityAt?: string | null;
  /** Canonical provider activity instant as an ISO string. */
  remoteLastPlayedAt?: string | null;
  achievements?: AchievementSummary | null;
  enrichmentStatus: EnrichmentStatus;
}

/**
 * A game page: the shared catalog identity (addressable by id, independent of
 * possession — future public pages) plus the requesting user's provider
 * entries linked to that identity.
 */
export interface GamePageResponse {
  identity: GameCatalogIdentity;
  entries: ReadonlyArray<GamePageEntry>;
}

export type SyncLibraryStatus =
  | "synced"
  | "private"
  | "unavailable"
  | "failed";

export interface SyncLibraryResult {
  status: SyncLibraryStatus;
}
