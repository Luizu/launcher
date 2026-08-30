import { useState } from "react";
import { Link } from "react-router-dom";
import type { LauncherGame } from "../../lib/merge-library";
import { ActionButton } from "../../components/button/action-button";
import { formatPlaytime } from "../../components/game-card/game-card";
import { InlineStatus } from "../../components/status/inline-status";
import { InstallStatus } from "../../components/status/install-status";
import type { UseGameActionsResult } from "../game-library/use-game-actions";
import { selectHeroMedia } from "../../lib/media-fallback";
import { usePrefersReducedMotion } from "../../lib/use-media-query";
import { providerLabel } from "../../lib/provider-label";
import { gameKey } from "./select-featured-game";

/** PT-BR meta vocabulary for the merged install states. */
const INSTALL_STATE_LABELS: Record<LauncherGame["installState"], string> = {
  installed: "Instalado",
  "not-installed": "Não instalado",
  installing: "Instalando",
  unknown: "Não verificado",
};

export interface HeroStageProps {
  game: LauncherGame;
  /** True while the local scan is pending: install states are untrustworthy. */
  scanPending?: boolean;
  /** True when the last sync failed: a subtle contextual note near the meta. */
  isStale?: boolean;
  /** The action engine from `useGameActions`; never reimplemented here. */
  actions: UseGameActionsResult;
}

/**
 * Derived title composition used only when neither catalog media nor
 * provider artwork exists — the stage is never blank. It carries the same
 * ambient loop as the media layer so the whole stage breathes together.
 */
function DerivedStageTitle({ name, ambient }: { name: string; ambient: boolean }) {
  return (
    <div
      aria-hidden="true"
      className={`absolute inset-0 overflow-hidden bg-gradient-to-br from-[#101a33] via-[#0a1224] to-[#050914] ${
        ambient ? "animate-ambient" : ""
      }`}
    >
      <span className="absolute -right-6 bottom-8 max-w-[70%] text-[clamp(64px,10vw,160px)] font-black leading-none tracking-tighter text-white/[0.06]">
        {name}
      </span>
    </div>
  );
}

/**
 * The stage for the featured game: best available media (catalog hero →
 * catalog other variants → provider artwork → derived title composition),
 * hero copy bottom-left, and the explicit primary action. Media pending,
 * unmatched, failed, or stale never blocks rendering — missing media simply
 * walks down the fallback chain. The primary action (Jogar/Instalar) fires
 * only on an explicit click; focusing games never launches.
 *
 * Motion: the media layer breathes with the approved ambient loop (18s,
 * subtle scale/translate, infinite alternate) — the only continuous motion
 * in the app. Changing the featured game fades through, not through-dark:
 * the previous media stays on stage until the new one reports ready
 * (`onLoad`) and then fades out in place (same 300ms window) while the new
 * layer fades in, so the stage never flashes empty and the dark background
 * never shows between layers; the outgoing layer is released on its
 * transition end. A media url that errors is replaced by the derived title.
 * Under `prefers-reduced-motion` the loop and the copy-in animation are
 * removed and the crossfade collapses to a quick opacity swap.
 */
export function HeroStage({
  game,
  scanPending = false,
  isStale = false,
  actions,
}: HeroStageProps) {
  const reducedMotion = usePrefersReducedMotion();
  const ambient = !reducedMotion;

  const identity = game.catalogIdentity ?? null;
  const mediaUrl = selectHeroMedia(identity, game.artwork);
  const title = identity?.name ?? game.name;
  const description = identity?.description ?? undefined;

  /** The media currently confirmed on stage (last `onLoad`), with its game. */
  const [displayed, setDisplayed] = useState<{
    src: string;
    gameKey: string;
  } | null>(null);
  /**
   * The src of the previous layer mid-fade-out: it stays mounted (dimming to
   * 0) until its transition ends, then is released. Keeping it mounted while
   * the new layer fades in is what makes the swap a fade-through instead of a
   * fade-through-dark.
   */
  const [leaving, setLeaving] = useState<string | null>(null);
  /** The game whose media url failed to load; its stage falls to the title. */
  const [failedGameKey, setFailedGameKey] = useState<string | null>(null);

  const currentKey = gameKey(game);
  // A media url that failed once for this game is treated as absent: the
  // fallback chain's tail (derived title) takes over for that game.
  const targetMedia =
    mediaUrl !== null && failedGameKey !== currentKey ? mediaUrl : null;

  // The title composition renders instantly: when the fallback takes over,
  // drop both the confirmed media and any layer mid-fade so neither can
  // linger as the "previous art" of the next swap. Adjusting state during
  // render is the documented pattern for state that depends on props; the
  // guard converges (displayed/leaving → null).
  if (targetMedia === null && (displayed !== null || leaving !== null)) {
    setDisplayed(null);
    setLeaving(null);
  }

  // A swap is pending when the target media differs from the confirmed one;
  // the previous art stays visible until the pending one reports ready —
  // the stage never flashes empty between games.
  const swapPending =
    targetMedia !== null && (displayed === null || targetMedia !== displayed.src);
  const previousSrc = swapPending && displayed !== null ? displayed.src : null;

  const primaryAction = scanPending ? (
    <ActionButton disabled>Verificando…</ActionButton>
  ) : game.installState === "installed" ? (
    <ActionButton
      className="bg-[#f8fbff] text-[#0c1422] hover:bg-white focus-visible:ring-[#8cf5d0]"
      disabled={actions.isLaunching}
      onClick={() => void actions.launch(game)}
    >
      <span aria-hidden="true">▶</span> Jogar
    </ActionButton>
  ) : game.installState === "not-installed" ? (
    <ActionButton
      className="bg-[#f8fbff] text-[#0c1422] hover:bg-white focus-visible:ring-[#8cf5d0]"
      disabled={actions.isInstalling}
      onClick={() => void actions.install(game)}
    >
      Instalar
    </ActionButton>
  ) : (
    <InstallStatus
      state={game.installState}
      disabled={actions.isLaunching || actions.isInstalling}
      onCheckSteam={() => void actions.openSteamDownloads()}
    />
  );

  return (
    <section aria-label="Jogo em destaque" className="absolute inset-0">
      {targetMedia !== null ? (
        <>
          {leaving !== null && (
            <img
              src={leaving}
              alt=""
              onTransitionEnd={() => setLeaving(null)}
              className={`absolute inset-0 h-full w-full object-cover opacity-0 transition-opacity motion-safe:duration-300 ${
                ambient ? "animate-ambient" : ""
              }`}
            />
          )}
          {previousSrc !== null && (
            <img
              src={previousSrc}
              alt=""
              className={`absolute inset-0 h-full w-full object-cover ${
                ambient ? "animate-ambient" : ""
              }`}
            />
          )}
          <img
            src={targetMedia}
            alt=""
            loading="eager"
            onLoad={() => {
              // First confirmation: the target simply takes the stage.
              if (displayed === null) {
                setDisplayed({ src: targetMedia, gameKey: currentKey });
              } else if (displayed.src !== targetMedia) {
                // The pending layer is ready: the old layer starts its
                // fade-out while this one fades in (fade-through).
                setLeaving(displayed.src);
                setDisplayed({ src: targetMedia, gameKey: currentKey });
              }
            }}
            onError={() => setFailedGameKey(currentKey)}
            className={`absolute inset-0 h-full w-full object-cover transition-opacity motion-safe:duration-300 ${
              swapPending ? "opacity-0" : "opacity-100"
            } ${ambient ? "animate-ambient" : ""}`}
          />
        </>
      ) : (
        <DerivedStageTitle name={title} ambient={ambient} />
      )}
      {/* Legibility scrims: keep the copy and the selector readable on any art. */}
      <div
        aria-hidden="true"
        className="absolute inset-0 bg-gradient-to-r from-black/90 via-black/40 to-black/10"
      />
      <div
        aria-hidden="true"
        className="absolute inset-0 bg-gradient-to-t from-[#050914] via-transparent to-black/20"
      />

      <div className="absolute bottom-[9%] left-[7%] z-10 max-w-[52%] max-[800px]:max-w-[70%]">
        <p className="text-[11px] font-extrabold uppercase tracking-[0.18em] text-[#8cf5d0]">
          Continuar jogando
        </p>
        {/* The keyed title replays the short copy-in on each selection change. */}
        <h2
          key={gameKey(game)}
          className={`mt-3 text-[clamp(40px,5.5vw,88px)] font-black leading-[0.9] tracking-tight text-white ${
            ambient ? "animate-copy-in" : ""
          }`}
        >
          {title}
        </h2>
        {description !== undefined && (
          <p className="mt-4 max-w-[570px] text-base leading-relaxed text-[#c8d3e4] max-[800px]:text-[13px]">
            {description}
          </p>
        )}
        <div className="mt-4 flex flex-wrap items-center gap-3 text-xs text-[#c8d5e8]">
          <span className="font-extrabold uppercase tracking-wider text-[#8cf5d0]">
            {providerLabel(game.provider)}
          </span>
          {game.playtimeMinutes !== undefined && (
            <>
              <span aria-hidden="true">•</span>
              <span>{formatPlaytime(game.playtimeMinutes)}</span>
            </>
          )}
          <span aria-hidden="true">•</span>
          <span>{INSTALL_STATE_LABELS[game.installState]}</span>
          {isStale && (
            <span className="text-[10px] text-zinc-400">
              mostrando última sincronização
            </span>
          )}
        </div>
        <div className="mt-5 flex items-center gap-3">
          {primaryAction}
          {identity !== null && (
            <Link
              to={`/games/${identity.id}`}
              className="inline-flex items-center justify-center rounded-md border border-[rgba(232,241,255,0.55)] bg-[rgba(3,8,17,0.35)] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[rgba(3,8,17,0.6)] focus:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400"
            >
              Detalhes
            </Link>
          )}
        </div>
        {actions.error !== null && (
          <div className="mt-4 max-w-md">
            <InlineStatus tone="error" onRetry={actions.retry}>
              {actions.error}
            </InlineStatus>
          </div>
        )}
      </div>
    </section>
  );
}
