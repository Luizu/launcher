import type { LibraryGame } from "../../lib/merge-library";

/**
 * Join key shared by the history and pinned seams, matching the merged
 * library's normalized ids: `provider:externalGameId` (e.g. `steam:730`).
 * Callers of the seams (ticket 06 history, future pinning UI) address games
 * by this key.
 */
export function gameKey(
  game: Pick<LibraryGame, "provider" | "externalGameId">,
): string {
  return `${game.provider}:${game.externalGameId}`;
}

export interface SelectFeaturedGameOptions {
  /**
   * Local play history seam (ticket 06 plugs persistence here): maps a game
   * key to its last-played instant as an ISO string. Empty in this delivery,
   * so the Home ranks by the stable installed order when there is no remote
   * activity.
   */
  history?: Record<string, string>;
  /**
   * Pinned entries seam (no pinning UI in this delivery): game keys in user
   * order. Empty by default; a pinned game only wins when the seam is fed.
   */
  pinned?: string[];
}

/** Deterministic ordering: name, then provider, then id. */
function byNameThenProvider(a: LibraryGame, b: LibraryGame): number {
  if (a.name !== b.name) return a.name < b.name ? -1 : 1;
  if (a.provider !== b.provider) return a.provider < b.provider ? -1 : 1;
  return a.externalGameId < b.externalGameId ? -1 : 1;
}

/** Sorts newest first; ties resolve deterministically by name+provider. */
function byDateThenName(
  dateOf: (game: LibraryGame) => string,
  a: LibraryGame,
  b: LibraryGame,
): number {
  const aDate = dateOf(a);
  const bDate = dateOf(b);
  if (aDate !== bDate) return aDate > bDate ? -1 : 1;
  return byNameThenProvider(a, b);
}

/**
 * Ranks every library game for the Home in the shared priority order:
 *
 * 1. remote activity (newest `lastActivityAt` first — any entry, a
 *    not-installed game is still actionable through INSTALAR);
 * 2. local history (newest first — the `history` seam, ticket 06);
 * 3. pinned entries in user order (the `pinned` seam);
 * 4. installed games by name, then provider;
 * 5. everything else by name, then provider — so every game is reachable.
 *
 * The ranking is fully deterministic for the same inputs (ties break by
 * name, then provider, then id) and deduplicates by game key, keeping the
 * first occurrence. The Home features the first game and shows the next
 * games in the floating selector.
 */
export function rankHomeGames(
  games: ReadonlyArray<LibraryGame>,
  { history = {}, pinned = [] }: SelectFeaturedGameOptions = {},
): ReadonlyArray<LibraryGame> {
  const ranked = new Map<string, LibraryGame>();
  const push = (game: LibraryGame) => {
    const key = gameKey(game);
    if (!ranked.has(key)) ranked.set(key, game);
  };

  const withActivity = games.filter(
    (game) => game.lastActivityAt != null && game.lastActivityAt !== "",
  );
  for (const game of [...withActivity].sort((a, b) =>
    byDateThenName((game) => game.lastActivityAt as string, a, b),
  )) {
    push(game);
  }

  const historyKeys = new Set(Object.keys(history));
  const withHistory = games.filter((game) => historyKeys.has(gameKey(game)));
  for (const game of [...withHistory].sort((a, b) =>
    byDateThenName((game) => history[gameKey(game)] as string, a, b),
  )) {
    push(game);
  }

  for (const key of pinned) {
    const game = games.find((candidate) => gameKey(candidate) === key);
    if (game !== undefined) push(game);
  }

  const installed = games.filter((game) => game.installState === "installed");
  for (const game of [...installed].sort(byNameThenProvider)) {
    push(game);
  }

  for (const game of [...games].sort(byNameThenProvider)) {
    push(game);
  }

  return [...ranked.values()];
}

/**
 * Chooses the featured game for the Home, in priority order:
 *
 * 1. highest remote `lastActivityAt` (any entry — a not-installed game is
 *    still actionable through INSTALAR);
 * 2. latest local history entry (the `history` seam, ticket 06);
 * 3. first pinned entry present in the library (the `pinned` seam);
 * 4. stable installed order (installed games by name, then provider).
 *
 * Remote activity beats local history so the direction ticket 06 must keep
 * already holds here. Entries without any activity are never dropped — they
 * stay eligible at the lower levels. The result is fully deterministic for
 * the same inputs; ties break by name, then provider. Returns `null` only
 * when there is genuinely nothing to feature (empty library, or only
 * not-installed entries without activity/history/pinning). The Home still
 * has {@link rankHomeGames} to fall back on for the selector.
 */
export function selectFeaturedGame(
  games: ReadonlyArray<LibraryGame>,
  { history = {}, pinned = [] }: SelectFeaturedGameOptions = {},
): LibraryGame | null {
  if (games.length === 0) return null;

  const withActivity = games.filter(
    (game) => game.lastActivityAt != null && game.lastActivityAt !== "",
  );
  if (withActivity.length > 0) {
    return [...withActivity].sort((a, b) =>
      byDateThenName(
        (game) => game.lastActivityAt as string,
        a,
        b,
      ),
    )[0];
  }

  const historyKeys = new Set(Object.keys(history));
  const withHistory = games.filter((game) => historyKeys.has(gameKey(game)));
  if (withHistory.length > 0) {
    return [...withHistory].sort((a, b) =>
      byDateThenName((game) => history[gameKey(game)] as string, a, b),
    )[0];
  }

  for (const key of pinned) {
    const game = games.find((candidate) => gameKey(candidate) === key);
    if (game !== undefined) return game;
  }

  const installed = games.filter((game) => game.installState === "installed");
  if (installed.length === 0) return null;
  return [...installed].sort(byNameThenProvider)[0];
}
