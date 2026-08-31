import { useState } from "react";
import { Link } from "react-router-dom";
import type { LibraryGame } from "../../lib/merge-library";
import { ActionButton } from "../../components/button/action-button";
import {
  formatPlaytime,
  getTotalPlaytimeMinutes,
  getRemoteLastPlayedAt,
  formatLastActivity,
} from "../../components/game-card/game-card";
import { InlineStatus } from "../../components/status/inline-status";
import { InstallStatus } from "../../components/status/install-status";
import type { UseGameActionsResult } from "../game-library/use-game-actions";
import { selectHeroMediaCandidates } from "../../lib/media-fallback";
import { usePrefersReducedMotion } from "../../lib/use-media-query";
import { providerLabel } from "../../lib/provider-label";
import { gameKey } from "./select-featured-game";
import { PlayIcon } from "../../components/icons/app-icon";

/** PT-BR meta vocabulary for the merged install states. */
const INSTALL_STATE_LABELS: Record<LibraryGame["installState"], string> = {
  installed: "Instalado",
  "not-installed": "Não instalado",
  installing: "Instalando",
  unknown: "Não verificado",
};

const HERO_PRIMARY_ACTION_CLASS =
  "shadow-[0_10px_30px_rgba(140,245,208,0.16)]";

function usableDescription(value: string | null | undefined): string | undefined {
  const description = value?.trim();
  return description ? description : undefined;
}

export interface HeroStageProps {
  game: LibraryGame;
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
 * hero copy upper-left, and the explicit primary action. Media pending,
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
  const currentKey = gameKey(game);
  const mediaCandidates = selectHeroMediaCandidates(
    identity,
    game.artwork,
    game.provider,
    game.externalGameId,
  );
  const title = identity?.name ?? game.name;
  const description =
    usableDescription(identity?.description) ??
    usableDescription(game.description);
  const totalPlaytimeMinutes = getTotalPlaytimeMinutes(game);
  const activityLabel = formatLastActivity(getRemoteLastPlayedAt(game));

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
  /** The last media layer confirmed by the browser; it gets the entrance animation. */
  const [justDisplayedSrc, setJustDisplayedSrc] = useState<string | null>(null);
  /** Failed candidates by game; the next candidate gets a chance. */
  const [failedMedia, setFailedMedia] = useState<{
    gameKey: string;
    sources: string[];
  } | null>(null);

  // A failed candidate is skipped only for its own game. This lets a
  // canonical Steam hero fall back to persisted/provider artwork without
  // poisoning another game that happens to share the same URL.
  const targetMedia =
    mediaCandidates.find(
      (candidate) =>
        failedMedia?.gameKey !== currentKey ||
        !failedMedia.sources.includes(candidate),
    ) ?? null;

  // The title composition renders instantly: when the fallback takes over,
  // drop both the confirmed media and any layer mid-fade so neither can
  // linger as the "previous art" of the next swap. Adjusting state during
  // render is the documented pattern for state that depends on props; the
  // guard converges (displayed/leaving → null).
  if (targetMedia === null && (displayed !== null || leaving !== null)) {
    setDisplayed(null);
    setLeaving(null);
    setJustDisplayedSrc(null);
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
      className={HERO_PRIMARY_ACTION_CLASS}
      disabled={actions.isLaunching}
      onClick={() => void actions.launch(game)}
    >
      <PlayIcon className="h-4 w-4" /> Jogar
    </ActionButton>
  ) : game.installState === "not-installed" ? (
    <ActionButton
      className={HERO_PRIMARY_ACTION_CLASS}
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
              onAnimationEnd={() => setLeaving(null)}
              className={`absolute inset-0 h-full w-full object-cover opacity-0 transition-opacity motion-safe:duration-450 ${
                ambient ? "animate-ambient" : ""
              } ${ambient ? "animate-media-out" : ""}`}
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
                setJustDisplayedSrc(targetMedia);
              } else if (displayed.src !== targetMedia) {
                // The pending layer is ready: the old layer starts its
                // fade-out while this one fades in (fade-through).
                setLeaving(displayed.src);
                setDisplayed({ src: targetMedia, gameKey: currentKey });
                setJustDisplayedSrc(targetMedia);
              }
            }}
            onError={() =>
              setFailedMedia((previous) => {
                if (previous?.gameKey === currentKey) {
                  return previous.sources.includes(targetMedia)
                    ? previous
                    : {
                        gameKey: currentKey,
                        sources: [...previous.sources, targetMedia],
                      };
                }
                return { gameKey: currentKey, sources: [targetMedia] };
              })
            }
            onAnimationEnd={() => {
              if (justDisplayedSrc === targetMedia) {
                setJustDisplayedSrc(null);
              }
            }}
            className={`absolute inset-0 h-full w-full object-cover transition-opacity motion-safe:duration-450 ${
              swapPending ? "opacity-0" : "opacity-100"
            } ${ambient ? "animate-ambient" : ""} ${
              ambient && justDisplayedSrc === targetMedia
                ? "animate-media-in"
                : ""
            }`}
          />
        </>
      ) : (
        <DerivedStageTitle name={title} ambient={ambient} />
      )}
      <div
        aria-hidden="true"
        data-cut-atmosphere
        className="pointer-events-none absolute inset-0 z-[1] overflow-hidden"
      >
        <span className="absolute -right-[8%] -top-[18%] h-[290px] w-[450px] rotate-[-16deg] rounded-[50%] border border-[#8cf5d0]/40 shadow-[0_0_0_28px_rgba(140,245,208,0.05),0_0_0_58px_rgba(140,245,208,0.025)]" />
      </div>
      {/* Legibility scrims: keep the copy and the selector readable on any art. */}
      <div
        aria-hidden="true"
        className="absolute inset-0 bg-gradient-to-r from-black/90 via-black/40 to-black/10"
      />
      <div
        aria-hidden="true"
        className="absolute inset-0 bg-gradient-to-t from-[#050914] via-transparent to-black/20"
      />

      <div
        key={currentKey}
        data-testid="hero-copy"
        data-approved-hero-copy
        className={`absolute left-[50px] top-[165px] z-10 max-w-[430px] max-[800px]:left-6 max-[800px]:top-[130px] max-[800px]:max-w-[70%] ${
          ambient ? "animate-copy-in" : ""
        }`}
      >
        <p className="mb-[15px] inline-flex items-center gap-2 text-[10px] font-extrabold uppercase tracking-[0.17em] text-[#8cf5d0]">
          <span aria-hidden="true" className="h-0.5 w-6 rounded-full bg-[#8cf5d0]" />
          Continuar jogando
        </p>
        <h2 className="m-0 text-[clamp(44px,6vw,72px)] font-black leading-[0.88] tracking-[-0.09em] text-white [text-shadow:0_8px_38px_rgba(0,0,0,0.35)]">
          {title}
        </h2>
        {description !== undefined && (
          <p className="mt-[18px] max-w-[340px] text-[13px] leading-[1.55] text-white/75 [text-shadow:0_2px_16px_rgba(0,0,0,0.45)]">
            {description}
          </p>
        )}
        <div className="mt-5 flex flex-wrap items-center gap-[10px] text-[11px] text-white/65 [text-shadow:0_2px_12px_rgba(0,0,0,0.5)]">
          <strong className="text-[#f2f6ff]">
            {INSTALL_STATE_LABELS[game.installState]}
          </strong>
          {totalPlaytimeMinutes !== undefined &&
            totalPlaytimeMinutes !== null && (
            <>
              <span
                aria-hidden="true"
                data-cut-meta-dot
                className="h-1 w-1 rounded-full bg-[#ff925e]"
              />
              <span>{formatPlaytime(totalPlaytimeMinutes)}</span>
            </>
          )}
          {activityLabel !== null && (
            <>
              <span
                aria-hidden="true"
                data-cut-meta-dot
                className="h-1 w-1 rounded-full bg-[#ff925e]"
              />
              <span>{activityLabel}</span>
            </>
          )}
          <span
            aria-hidden="true"
            data-cut-meta-dot
            className="h-1 w-1 rounded-full bg-[#ff925e]"
          />
          <span>{providerLabel(game.provider)}</span>
          {isStale && (
            <span className="text-[10px] text-zinc-400">
              mostrando última sincronização
            </span>
          )}
        </div>
        <div className="mt-7 flex items-center gap-[11px]">
          {primaryAction}
          {identity !== null && (
            <Link
              to={`/games/${identity.id}`}
              data-discover
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
