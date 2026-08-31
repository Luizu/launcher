import { useRef, type KeyboardEvent } from "react";
import type { LibraryGame } from "../../lib/merge-library";
import { selectSelectorCover } from "../../lib/media-fallback";
import { useCompactViewport } from "../../lib/use-media-query";
import { providerLabel } from "../../lib/provider-label";
import type { UseGameActionsResult } from "../game-library/use-game-actions";
import { gameKey } from "./select-featured-game";

/**
 * The selector's top offset keeps breathing room below the topbar:
 * 145px = topbar (72px) + 73px of air. On compact windows the topbar is
 * 58px, so the offset becomes 109px to preserve the same proportion
 * (58 + 51) without coupling to the chrome height.
 */
const SELECTOR_TOP_WIDE = "top-[145px]";
const SELECTOR_TOP_COMPACT = "top-[109px]";

export interface GameSelectorProps {
  /** The games to browse: installed games, or the top prioritized library. */
  games: ReadonlyArray<LibraryGame>;
  /** Key of the item currently emphasized (focused, else featured). */
  activeKey: string | null;
  /** Focuses a game; the hero commits after the debounce (never launches). */
  onFocusGame: (key: string) => void;
  /**
   * The action engine (from `useGameActions`): when present, tiles of
   * not-installed games show an Instalar action; without it the selector
   * stays purely presentational (focus behavior only).
   */
  actions?: UseGameActionsResult;
}

/**
 * The floating selector: the priority games inside the scene, below the
 * topbar with breathing room (never a bottom dock), with the active item
 * emphasized (mint outline + slightly larger) and horizontal scrolling for
 * overflow. With anything installed it browses the installed set; on a
 * machine with nothing installed it falls back to the top prioritized
 * library games, whose tiles carry their install state and an Instalar
 * action. Arrow keys move focus between items; focusing or clicking an item
 * only updates the featured game after the debounce. Items are tabbable
 * tiles (a non-button wrapper so the Instalar action is never nested inside
 * a button) with `aria-current` on the active one, Enter/Space commit the
 * focused game, and every item shows a visible focus-visible outline for
 * keyboard users.
 */
export function GameSelector({
  games,
  activeKey,
  onFocusGame,
  actions,
}: GameSelectorProps) {
  const listRef = useRef<HTMLUListElement>(null);
  const compact = useCompactViewport();
  const anyInstalled = games.some((game) => game.installState === "installed");

  const handleKeyDown = (event: KeyboardEvent<HTMLUListElement>) => {
    if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
    const tiles = Array.from(
      listRef.current?.querySelectorAll<HTMLElement>("[data-game-key]") ?? [],
    );
    if (tiles.length === 0) return;
    // The focus may live on a tile or on a leaf action inside one; either
    // way the current item is the tile that contains the active element.
    const index = tiles.findIndex((tile) => tile.contains(document.activeElement));
    const nextIndex = event.key === "ArrowRight" ? index + 1 : index - 1;
    if (nextIndex < 0 || nextIndex >= tiles.length) return;
    tiles[nextIndex].focus();
    event.preventDefault();
  };

  return (
    <section
      aria-label="Seletor de jogos"
      className={`absolute left-[5%] right-4 z-10 ${
        compact ? SELECTOR_TOP_COMPACT : SELECTOR_TOP_WIDE
      }`}
    >
      <div className="mb-3 flex items-baseline gap-3">
        <h3 className="text-xs font-extrabold uppercase tracking-wider text-[#f2f6ff]">
          {anyInstalled ? "Jogos instalados" : "Sua biblioteca"}
        </h3>
        {anyInstalled && (
          <span className="text-[10px] font-bold uppercase tracking-[0.12em] text-[#8cf5d0]">
            {games.length} neste PC
          </span>
        )}
      </div>
      <ul
        ref={listRef}
        onKeyDown={handleKeyDown}
        className="flex items-start gap-3.5 overflow-x-auto pb-3"
      >
        {games.map((game) => {
          const key = gameKey(game);
          const active = key === activeKey;
          const cover = selectSelectorCover(game.catalogIdentity ?? null, game.artwork);
          return (
            <li key={key} className="shrink-0">
              <div
                role="button"
                tabIndex={0}
                data-game-key={key}
                aria-current={active ? "true" : undefined}
                aria-label={`${game.name} (${providerLabel(game.provider)})`}
                onFocus={() => onFocusGame(key)}
                onClick={() => onFocusGame(key)}
                onKeyDown={(event) => {
                  // Enter/Space commit the focused game to the hero — they
                  // never launch it (a div has no native activation).
                  if (event.key !== "Enter" && event.key !== " ") return;
                  event.preventDefault();
                  onFocusGame(key);
                }}
                className={`group flex w-[86px] cursor-pointer flex-col items-center text-center focus:outline-none focus-visible:outline-2 focus-visible:outline-[#8cf5d0] focus-visible:outline-offset-2 ${
                  active ? "" : "opacity-75 hover:opacity-95"
                }`}
              >
                {cover !== null ? (
                  <img
                    src={cover}
                    alt=""
                    loading="lazy"
                    decoding="async"
                    className={`rounded-md object-cover shadow-lg transition-all ${
                      active
                        ? "h-[104px] w-[130px] -translate-y-1 outline-2 outline-[#8cf5d0] outline-offset-3"
                        : "h-[70px] w-[86px] group-focus-visible:outline-2 group-focus-visible:outline-[#8cf5d0] group-focus-visible:outline-offset-3"
                    }`}
                  />
                ) : (
                  <span
                    aria-hidden="true"
                    className={`grid place-items-center rounded-md bg-gradient-to-br from-[#161e3a] to-[#a05ce1] font-black text-white shadow-lg transition-all ${
                      active
                        ? "h-[104px] w-[130px] -translate-y-1 text-[10px] outline-2 outline-[#8cf5d0] outline-offset-3"
                        : "h-[70px] w-[86px] text-[9px]"
                    }`}
                  >
                    {game.name.slice(0, 12)}
                  </span>
                )}
                <span
                  className={`mt-2 block max-w-full truncate text-[10px] font-extrabold ${
                    active ? "text-white" : "text-[#d3dced]"
                  }`}
                >
                  {game.name}
                </span>
                <span className="mt-0.5 text-[9px] font-bold uppercase tracking-widest text-[#8cf5d0]/70">
                  {providerLabel(game.provider)}
                </span>
                {actions !== undefined && game.installState === "not-installed" && (
                  <button
                    type="button"
                    aria-label={`Instalar ${game.name}`}
                    disabled={actions.isInstalling}
                    onClick={(event) => {
                      // Installing is a leaf action: it never focuses or
                      // commits the tile, so the featured game cannot change
                      // as a side effect of installing.
                      event.stopPropagation();
                      void actions.install(game);
                    }}
                    onKeyDown={(event) => event.stopPropagation()}
                    onFocus={(event) => event.stopPropagation()}
                    className="mt-1 rounded border border-[#8cf5d0]/60 px-2 py-0.5 text-[9px] font-extrabold uppercase tracking-widest text-[#8cf5d0] transition-colors hover:bg-[#8cf5d0]/10 focus:outline-none focus-visible:outline-2 focus-visible:outline-[#8cf5d0] focus-visible:outline-offset-2"
                  >
                    Instalar
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
