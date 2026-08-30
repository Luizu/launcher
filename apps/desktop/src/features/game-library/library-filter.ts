import type { LauncherGame } from "../../lib/merge-library";

/** Sort keys offered by the Biblioteca toolbar. */
export type LibrarySortKey = "default" | "title" | "activity" | "playtime";

export interface LibraryFilterOptions {
  /** Raw search text; trimmed and compared case-insensitively. */
  query: string;
  /** True hides every game whose merged install state is not installed. */
  installedOnly: boolean;
  /** Provider id to keep, or "all" for every provider. */
  provider: string;
}

/** Title the UI shows for a game: catalog identity name when enriched. */
export function displayedTitle(game: LauncherGame): string {
  return game.catalogIdentity?.name ?? game.name;
}

/** Unique providers in first-appearance order; drives the provider filter. */
export function libraryProviders(games: readonly LauncherGame[]): string[] {
  const providers: string[] = [];
  for (const game of games) {
    if (!providers.includes(game.provider)) providers.push(game.provider);
  }
  return providers;
}

/**
 * Client-side search + filters over the merged library, applied with AND.
 * The query matches the displayed title case-insensitively; an empty (or
 * blank) query keeps every game. Enrichment status never affects the match.
 */
export function filterGames(
  games: readonly LauncherGame[],
  { query, installedOnly, provider }: LibraryFilterOptions,
): LauncherGame[] {
  const normalizedQuery = query.trim().toLocaleLowerCase("pt-BR");
  return games.filter((game) => {
    if (installedOnly && game.installState !== "installed") return false;
    if (provider !== "all" && game.provider !== provider) return false;
    if (normalizedQuery !== "") {
      const title = displayedTitle(game).toLocaleLowerCase("pt-BR");
      if (!title.includes(normalizedQuery)) return false;
    }
    return true;
  });
}

/** Last activity as a timestamp, or null when absent or unparsable. */
function activityTime(game: LauncherGame): number | null {
  const value = game.lastActivityAt;
  if (value == null) return null;
  const time = new Date(value).getTime();
  return Number.isNaN(time) ? null : time;
}

function compareNames(a: LauncherGame, b: LauncherGame): number {
  return displayedTitle(a).localeCompare(displayedTitle(b), "pt");
}

/** Full-order tie-break so every sort stays deterministic per render. */
function compareKeys(a: LauncherGame, b: LauncherGame): number {
  return `${a.provider}:${a.externalGameId}`.localeCompare(
    `${b.provider}:${b.externalGameId}`,
  );
}

function tieBreak(a: LauncherGame, b: LauncherGame): number {
  return compareNames(a, b) || compareKeys(a, b);
}

/**
 * Stable ordering for the toolbar, never mutating the input:
 * - `default`: merged library order (deterministic from the sources).
 * - `title`: displayed title with pt-aware collation.
 * - `activity`: `lastActivityAt` descending; entries without activity
 *   (absent or unparsable) sort last, tied by name.
 * - `playtime`: playtime descending; missing playtime treated as zero, tied
 *   by name. Ties (e.g. duplicate titles across providers) break by
 *   `provider:externalGameId` so the order never flips between renders.
 */
export function sortGames(
  games: readonly LauncherGame[],
  sortKey: LibrarySortKey,
): LauncherGame[] {
  const sorted = [...games];
  if (sortKey === "title") {
    sorted.sort((a, b) => compareNames(a, b) || compareKeys(a, b));
  } else if (sortKey === "activity") {
    sorted.sort((a, b) => {
      const aTime = activityTime(a);
      const bTime = activityTime(b);
      if (aTime === null && bTime === null) return tieBreak(a, b);
      if (aTime === null) return 1;
      if (bTime === null) return -1;
      return bTime - aTime || tieBreak(a, b);
    });
  } else if (sortKey === "playtime") {
    sorted.sort((a, b) => {
      const aMinutes = a.playtimeMinutes ?? 0;
      const bMinutes = b.playtimeMinutes ?? 0;
      return bMinutes - aMinutes || tieBreak(a, b);
    });
  }
  return sorted;
}
