import type {
  CatalogIdentityMedia,
  GameCatalogIdentity,
  MediaPurpose,
  MediaVariant,
} from "@fuse-launcher/contracts";

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
): string | null {
  if (identity !== null) {
    const hero = bestVariant(identity, "hero");
    if (hero !== null) return hero.url;
    const gamePage = bestVariant(identity, "game-page");
    if (gamePage !== null) return gamePage.url;
    const cover = coverVariant(identity);
    if (cover !== null) return cover.url;
  }
  return providerArtwork ?? null;
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
