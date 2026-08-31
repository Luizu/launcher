import { Link } from "react-router-dom";
import { LibraryState } from "../../components/status/library-state";
import type { GameLibraryClientLike } from "../game-library/game-library-client";
import type { GameActionsClientLike } from "../game-library/use-game-actions";
import type { LocalLibraryClientLike } from "../local-library/local-library-client";
import type { OpenUrl } from "../platform-connections/use-steam-connection";
import { GameSelector } from "./game-selector";
import { HeroStage } from "./hero-stage";
import { gameKey } from "./select-featured-game";
import { useHome } from "./use-home";

export interface HomePageProps {
  gameLibrary?: GameLibraryClientLike;
  localLibrary?: LocalLibraryClientLike;
  /** Native game actions (launch/install/status); defaults to TauriClient. */
  tauri?: GameActionsClientLike;
  /** The opener plugin binding for the `Verificar na Steam` action. */
  openUrl?: OpenUrl;
}

/**
 * The Home: a full-bleed stage for the featured game (media chain with a
 * derived title fallback, upper-left hero copy, explicit Jogar/Instalar
 * action) plus the bottom-anchored selector inside the scene. The composition
 * owns the loading/empty states, the stale connection note near the meta (the
 * topbar stays indicator-free by design), and clear access to the Library and
 * to game pages when a catalog identity exists.
 */
export function HomePage({
  gameLibrary,
  localLibrary,
  tauri,
  openUrl,
}: HomePageProps) {
  const home = useHome({ gameLibrary, localLibrary, tauri, openUrl });

  if (home.isLoading) {
    return (
      <div className="flex flex-1 flex-col gap-6 overflow-y-auto px-6 pb-6 pt-[104px] max-[800px]:pt-[82px]">
        <h1 className="sr-only">Home</h1>
        <LibraryState loading />
      </div>
    );
  }

  return (
    <div className="relative flex h-full min-h-0 flex-1 flex-col overflow-hidden bg-[#050914]">
      <h1 className="sr-only">Home</h1>
      {home.featured === null ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-4 p-8 text-center">
          <p className="text-sm text-zinc-300">
            Nenhum jogo para mostrar ainda.
          </p>
          <p className="max-w-md text-sm text-zinc-500">
            Seus jogos instalados e sua atividade recente aparecem aqui. A
            Biblioteca reúne tudo o que o Fuse Launcher conhece sobre seus jogos.
          </p>
          <Link
            to="/library"
            className="mt-2 inline-flex items-center justify-center rounded-md bg-[#8cf5d0] px-4 py-2 text-sm font-bold text-[#0c1422] transition-colors hover:bg-[#a5f8db] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#8cf5d0]"
          >
            Ir para a Biblioteca
          </Link>
        </div>
      ) : (
        <>
          <HeroStage
            game={home.featured}
            scanPending={home.scanPending}
            isStale={home.isStale}
            actions={home.actions}
          />
          {home.selectorGames.length > 0 && (
            <GameSelector
              games={home.selectorGames}
              activeKey={home.focusedKey ?? gameKey(home.featured)}
              onFocusGame={home.focusGame}
              actions={home.actions}
            />
          )}
        </>
      )}
    </div>
  );
}
