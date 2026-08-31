import { useRef, type KeyboardEvent } from "react";
import type { LibraryGame } from "../../lib/merge-library";
import { selectSelectorCover } from "../../lib/media-fallback";
import { useCompactViewport } from "../../lib/use-media-query";
import { providerLabel } from "../../lib/provider-label";
import type { UseGameActionsResult } from "../game-library/use-game-actions";
import { gameKey } from "./select-featured-game";

export interface GameSelectorProps {
  /** The games to browse: four installed games, or the top prioritized library. */
  games: ReadonlyArray<LibraryGame>;
  /** Key of the item currently emphasized (focused, else featured). */
  activeKey: string | null;
  /** Focuses a game; the hero commits after the debounce (never launches). */
  onFocusGame: (key: string) => void;
  /** Native game actions used only by the no-install fallback state. */
  actions?: UseGameActionsResult;
}

/**
 * The approved Home strip: a small set of landscape covers anchored to the
 * bottom of the hero scene. The strip never duplicates a second "recently
 * played" section, and it stays keyboard-operable when it overflows.
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
    const index = tiles.findIndex((tile) => tile.contains(document.activeElement));
    const nextIndex = event.key === "ArrowRight" ? index + 1 : index - 1;
    if (nextIndex < 0 || nextIndex >= tiles.length) return;
    tiles[nextIndex].focus();
    event.preventDefault();
  };

  return (
    <section
      aria-label="Seletor de jogos"
      data-approved-selector
      className={`absolute z-10 flex items-end gap-[9px] ${
        compact
          ? "bottom-5 left-5 right-5"
          : "bottom-[35px] left-[42px] right-[42px]"
      }`}
    >
      <p className="w-[105px] shrink-0 pb-[7px] text-[10px] font-extrabold uppercase tracking-[0.08em] text-white/70 [text-shadow:0_2px_12px_rgba(0,0,0,0.6)]">
        {anyInstalled ? "Jogos instalados" : "Sua biblioteca"}
      </p>
      <ul
        ref={listRef}
        onKeyDown={handleKeyDown}
        className="flex min-w-0 flex-1 items-end gap-[9px] overflow-x-auto pb-0"
      >
        {games.map((game) => {
          const key = gameKey(game);
          const active = key === activeKey;
          const cover = selectSelectorCover(game.catalogIdentity ?? null, game.artwork);
          return (
            <li key={key} className="min-w-[160px] flex-1">
              <div
                role="button"
                tabIndex={0}
                data-game-key={key}
                data-selector-orientation="landscape"
                aria-current={active ? "true" : undefined}
                aria-label={`${game.name} (${providerLabel(game.provider)})`}
                onFocus={() => onFocusGame(key)}
                onClick={() => onFocusGame(key)}
                onKeyDown={(event) => {
                  if (event.key !== "Enter" && event.key !== " ") return;
                  event.preventDefault();
                  onFocusGame(key);
                }}
                className={`group relative block h-[64px] w-full cursor-pointer overflow-hidden rounded-[7px] border bg-[#233a56] text-left shadow-[0_8px_17px_rgba(0,0,0,0.38)] transition-[height,opacity,border-color,box-shadow] duration-200 focus:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#8cf5d0] ${
                  active
                    ? "h-[77px] border-[#8cf5d0] shadow-[0_0_0_1px_rgba(140,245,208,0.28),0_9px_22px_rgba(0,0,0,0.48)]"
                    : "border-white/25 opacity-75 hover:opacity-100"
                }`}
              >
                {cover !== null ? (
                  <img
                    src={cover}
                    alt=""
                    loading="lazy"
                    decoding="async"
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <span
                    aria-hidden="true"
                    className="grid h-full w-full place-items-center bg-gradient-to-br from-[#172840] to-[#07101b] text-xs font-black text-white/75"
                  >
                    {game.name.slice(0, 18)}
                  </span>
                )}
                <span
                  aria-hidden="true"
                  className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/10 to-transparent"
                />
                <span className="absolute bottom-[7px] left-2 right-2 z-[1] truncate text-[9px] font-extrabold text-white">
                  {game.name}
                </span>
                <span className="sr-only">{providerLabel(game.provider)}</span>
                {actions !== undefined &&
                  !anyInstalled &&
                  game.installState === "not-installed" && (
                    <button
                      type="button"
                      aria-label={`Instalar ${game.name}`}
                      disabled={actions.isInstalling}
                      onClick={(event) => {
                        event.stopPropagation();
                        void actions.install(game);
                      }}
                      onKeyDown={(event) => event.stopPropagation()}
                      onFocus={(event) => event.stopPropagation()}
                      className="absolute bottom-1 right-1 z-10 rounded border border-[#8cf5d0]/70 bg-[#07101b]/75 px-2 py-0.5 text-[9px] font-extrabold uppercase tracking-widest text-[#8cf5d0] transition-colors hover:bg-[#8cf5d0]/15 focus:outline-none focus-visible:outline-2 focus-visible:outline-[#8cf5d0] focus-visible:outline-offset-2"
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
