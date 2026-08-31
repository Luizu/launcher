import type {
  CatalogIdentityMedia,
  GameCatalogIdentity,
  MediaPurpose,
  MediaVariant,
  PlatformId,
} from "@fuse-launcher/contracts";

const STEAM_LIBRARY_CDN = "https://cdn.cloudflare.steamstatic.com/steam/apps";

/** Scan order across the media groups; per-group order is the API's. */
const VARIANT_GROUPS: ReadonlyArray<keyof CatalogIdentityMedia> = [
  "screenshot",
  "artwork",
  "cover",
];

/**
 * Largest variant with the wanted purpose, scanning the media groups in
 * order: density wins (the 2x hero, the cover_big selector, the 1080p 2x
 * game-page), ties resolve to the earliest group and variant.
 */
function bestVariant(
  identity: GameCatalogIdentity,
  purpose: MediaPurpose,
): MediaVariant | null {
  let best: MediaVariant | null = null;
  for (const group of VARIANT_GROUPS) {
    for (const candidate of identity.media[group] ?? []) {
      if (candidate.purpose !== purpose) continue;
      if (best === null || candidate.width > best.width) best = candidate;
    }
  }
  return best;
}

/** Largest variant from the cover group (any purpose), scaled by the UI. */
function coverVariant(identity: GameCatalogIdentity): MediaVariant | null {
  let best: MediaVariant | null = null;
  for (const candidate of identity.media.cover ?? []) {
    if (best === null || candidate.width > best.width) best = candidate;
  }
  return best;
}

function steamAppId(
  provider: PlatformId | null | undefined,
  externalGameId: string | null | undefined,
): string | null {
  if (provider !== "steam" || externalGameId === null || externalGameId === undefined) {
    return null;
  }

  const normalized = externalGameId.trim();
  return /^\d+$/.test(normalized) ? String(Number(normalized)) : null;
}

function steamLibraryAsset(
  provider: PlatformId | null | undefined,
  externalGameId: string | null | undefined,
  filename: string,
): string | null {
  const appId = steamAppId(provider, externalGameId);
  return appId === null
    ? null
    : STEAM_LIBRARY_CDN + "/" + appId + "/" + filename;
}

function pushCandidate(
  candidates: string[],
  candidate: string | null | undefined,
) {
  if (
    candidate !== null &&
    candidate !== undefined &&
    !candidates.includes(candidate)
  ) {
    candidates.push(candidate);
  }
}

/**
 * Ordered hero candidates. The canonical Steam library hero sits ahead of
 * persisted provider artwork because the latter may be an old arbitrary
 * gameplay screenshot. Keeping the tail candidate makes a missing Steam
 * library asset degrade to the provider artwork instead of a blank stage.
 */
export function selectHeroMediaCandidates(
  identity: GameCatalogIdentity | null,
  providerArtwork?: string | null,
  provider?: PlatformId | null,
  externalGameId?: string | null,
): string[] {
  const candidates: string[] = [];
  if (identity !== null) {
    pushCandidate(candidates, bestVariant(identity, "hero")?.url);
    pushCandidate(candidates, bestVariant(identity, "game-page")?.url);
  }
  pushCandidate(
    candidates,
    steamLibraryAsset(provider, externalGameId, "library_hero.jpg"),
  );
  if (identity !== null) {
    pushCandidate(candidates, coverVariant(identity)?.url);
  }
  pushCandidate(candidates, providerArtwork);
  return candidates;
}

/**
 * Best available hero media for the stage, in fallback order:
 * catalog `hero` variant (screenshot_huge or artwork) → catalog
 * `game-page` variant → a cover-group variant scaled → provider artwork →
 * `null` (the stage renders a derived title composition; a blank stage is
 * never acceptable). Pending, unmatched, failed, or stale catalog state all
 * surface as a missing identity/media here, so none of them can block the
 * hero.
 */
export function selectHeroMedia(
  identity: GameCatalogIdentity | null,
  providerArtwork?: string | null,
  provider?: PlatformId | null,
  externalGameId?: string | null,
): string | null {
  return (
    selectHeroMediaCandidates(identity, providerArtwork, provider, externalGameId)[0] ??
    null
  );
}

/**
 * Best available media for a game page: a `game-page` variant first (1080p
 * screenshots/artwork or cover_big), then a hero variant, then a cover-group
 * variant → `null` (the page renders a derived title tile; a definitive
 * media absence never errors).
 */
export function selectGamePageMedia(
  identity: GameCatalogIdentity | null,
): string | null {
  if (identity === null) return null;
  const gamePage = bestVariant(identity, "game-page");
  if (gamePage !== null) return gamePage.url;
  const hero = bestVariant(identity, "hero");
  if (hero !== null) return hero.url;
  const cover = coverVariant(identity);
  if (cover !== null) return cover.url;
  return null;
}

/**
 * Best available cover for compact tiles (selector rows and library cards):
 * catalog `selector` variant → a cover-group variant → provider artwork →
 * `null` (the tile renders a derived placeholder).
 */
export function selectSelectorCover(
  identity: GameCatalogIdentity | null,
  providerArtwork?: string | null,
): string | null {
  if (identity !== null) {
    const selector = bestVariant(identity, "selector");
    if (selector !== null) return selector.url;
    const cover = coverVariant(identity);
    if (cover !== null) return cover.url;
  }
  return providerArtwork ?? null;
}

/**
 * Library cards have a separate media role from the Home stage. Prefer the
 * catalog's selector cover, then Steam's canonical library cover, and only
 * use provider artwork for providers without a canonical cover URL. A Home
 * hero image therefore cannot leak into a Steam library card when the
 * catalog is pending or unmatched.
 */
export function selectLibraryCover(
  identity: GameCatalogIdentity | null,
  provider: PlatformId,
  externalGameId: string,
  providerArtwork?: string | null,
): string | null {
  if (identity !== null) {
    const selector = bestVariant(identity, "selector");
    if (selector !== null) return selector.url;
    const cover = coverVariant(identity);
    if (cover !== null) return cover.url;
  }

  const steamCover = steamLibraryAsset(
    provider,
    externalGameId,
    "library_600x900_2x.jpg",
  );
  if (steamCover !== null) return steamCover;
  return providerArtwork ?? null;
}

/**
 * Title-derived initials for the visual fallback tile when neither catalog
 * media nor provider artwork exists (e.g. "Counter-Strike 2" → "C2",
 * "Fallout" → "F"). An empty string when the name is blank; callers render
 * the plain placeholder tile.
 */
export function titleInitials(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => word[0] ?? "")
    .join("")
    .toUpperCase();
}
