import { useState } from "react";
import { Link } from "react-router-dom";
import type { EnrichmentStatus } from "@fuse-launcher/contracts";
import {
  selectLibraryCover,
  selectSelectorCover,
  titleInitials,
} from "../../lib/media-fallback";
import { providerLabel } from "../../lib/provider-label";
import type { LibraryGame } from "../../lib/merge-library";
import { ActionButton } from "../button/action-button";
import { InstallStatus } from "../status/install-status";

export interface GameCardProps {
  game: LibraryGame;
  /** The reference-style landscape treatment used by Biblioteca. */
  appearance?: "default" | "library";
  /** Dispatches a launch for an installed game; wired by `useGameActions`. */
  onLaunch?: (game: LibraryGame) => void | Promise<void>;
  /** Requests installation for a remote not-installed game. */
  onInstall?: (game: LibraryGame) => void | Promise<void>;
  /** Opens Steam's downloads page when the install state cannot be verified. */
  onCheckSteam?: (game: LibraryGame) => void | Promise<void>;
  /**
   * True while the local scan is still pending: the merged install states are
   * not trustworthy yet, so the action area shows a neutral disabled
   * placeholder instead of a misleading "Instalar" (the remote list may have
   * resolved before the local snapshot).
   */
  scanPending?: boolean;
}

export function formatPlaytime(minutes: number): string {
  if (minutes < 60) return `${minutes} min jogados`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours}h jogados` : `${hours}h${rest} jogados`;
}

/** Compact duration used by the progress summary on a game detail page. */
export function formatPlaytimeCompact(minutes: number): string {
  const normalized = Math.max(0, Math.floor(minutes));
  if (normalized < 60) return `${normalized} min`;
  const hours = Math.floor(normalized / 60);
  const rest = normalized % 60;
  return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`;
}

/** Reads canonical playtime without turning an explicit unknown into zero. */
export function getTotalPlaytimeMinutes(
  game: Pick<LibraryGame, "playtimeTotalMinutes" | "playtimeMinutes">,
): number | null | undefined {
  return game.playtimeTotalMinutes !== undefined
    ? game.playtimeTotalMinutes
    : game.playtimeMinutes;
}

/** Reads canonical remote activity without falling back from an explicit null. */
export function getRemoteLastPlayedAt(
  game: Pick<LibraryGame, "remoteLastPlayedAt" | "lastActivityAt">,
): string | null | undefined {
  return game.remoteLastPlayedAt !== undefined
    ? game.remoteLastPlayedAt
    : game.lastActivityAt;
}

/** Absolute PT-BR date keeps the remote activity precise and timezone-stable. */
export function formatLastActivity(
  value: string | null | undefined,
): string | null {
  if (value === null || value === undefined) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;

  const day = String(date.getUTCDate()).padStart(2, "0");
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  return `Jogado em ${day}/${month}/${date.getUTCFullYear()}`;
}

/** Entry-level copy for catalog states that are not ready; nothing blocks. */
const ENRICHMENT_LABELS: Partial<Record<EnrichmentStatus, string>> = {
  pending: "Atualizando capa",
  failed: "Catálogo indisponível",
  unmatched: "Sem dados de catálogo",
};

const INSTALL_STATE_LABELS: Record<LibraryGame["installState"], string> = {
  installed: "Instalado",
  "not-installed": "Não instalado",
  installing: "Instalando",
  unknown: "Não verificado",
};

/**
 * One library game card in the Biblioteca grid: catalog cover (or a
 * title-derived fallback tile when neither catalog media nor provider
 * artwork exists), provider badge, optional enrichment badge, display name
 * (catalog identity name when enriched), optional playtime, and exactly one
 * primary action derived from the merged install state. The action button is
 * disabled while its action promise is pending so duplicate clicks cannot
 * fire; the page wires the handlers through `useGameActions`. Raw AppIDs and
 * local paths never appear. The same title owned in two providers renders as
 * two separate cards, each with its own badge, install state, and action.
 */
export function GameCard({
  game,
  appearance = "default",
  onLaunch,
  onInstall,
  onCheckSteam,
  scanPending = false,
}: GameCardProps) {
  const [busy, setBusy] = useState(false);

  const runAction =
    (action?: (game: LibraryGame) => void | Promise<void>) => () => {
      if (busy || action === undefined) return;
      setBusy(true);
      void Promise.resolve(action(game))
        .catch(() => undefined)
        .finally(() => setBusy(false));
    };

  const action = scanPending ? (
    <ActionButton disabled>Verificando…</ActionButton>
  ) : game.installState === "installed" ? (
    <ActionButton disabled={busy || !onLaunch} onClick={runAction(onLaunch)}>
      Jogar
    </ActionButton>
  ) : game.installState === "not-installed" ? (
    <ActionButton disabled={busy || !onInstall} onClick={runAction(onInstall)}>
      Instalar
    </ActionButton>
  ) : (
    <InstallStatus
      state={game.installState}
      disabled={busy}
      onCheckSteam={runAction(onCheckSteam)}
    />
  );

  const identity = game.catalogIdentity ?? null;
  const title = identity?.name ?? game.name;
  const isLibraryAppearance = appearance === "library";
  const coverUrl = isLibraryAppearance
    ? selectLibraryCover(
        identity,
        game.provider,
        game.externalGameId,
        game.artwork,
      )
    : selectSelectorCover(identity, game.artwork);
  const enrichmentLabel = game.enrichmentStatus
    ? ENRICHMENT_LABELS[game.enrichmentStatus]
    : undefined;
  const totalPlaytimeMinutes = getTotalPlaytimeMinutes(game);
  const activityLabel = formatLastActivity(getRemoteLastPlayedAt(game));

  return (
    <article
      data-card-appearance={appearance}
      className={
        isLibraryAppearance
          ? "group relative min-w-0"
          : "group flex min-w-0 flex-col gap-3 rounded-2xl border border-white/10 bg-[#0b1322]/80 p-3 shadow-[0_18px_45px_rgba(0,0,0,0.18)] transition-colors hover:border-[#8cf5d0]/30"
      }
    >
      <div
        data-game-cover
        className={
          isLibraryAppearance
            ? "relative aspect-[1.9/1] w-full overflow-hidden rounded-[8px] border border-white/10 bg-[#1c2c42] shadow-[0_8px_18px_rgba(0,0,0,0.25)]"
            : "aspect-[3/4] w-full overflow-hidden rounded-xl bg-[#111b2d]"
        }
      >
        {coverUrl !== null ? (
          <img
            src={coverUrl}
            alt=""
            loading="lazy"
            decoding="async"
            className="h-full w-full object-cover"
          />
        ) : (
          <div
            aria-hidden="true"
            className="flex h-full w-full items-center justify-center bg-gradient-to-br from-[#111b2d] to-[#07101b]"
          >
            <span className="text-4xl font-black tracking-tight text-zinc-600">
              {titleInitials(title)}
            </span>
          </div>
        )}
        {isLibraryAppearance && (
          <span
            aria-hidden="true"
            data-game-status-bar
            className={`absolute bottom-2 left-2 right-2 h-[3px] rounded-full ${
              game.installState === "installed" ? "bg-[#8cf5d0]" : "bg-white/15"
            }`}
          />
        )}
      </div>
      <div
        className={
          isLibraryAppearance
            ? "mt-[9px] flex min-w-0 flex-col gap-1"
            : "flex min-w-0 flex-col gap-1"
        }
      >
        {identity !== null ? (
          <Link
            to={`/games/${identity.id}`}
            className={`truncate transition-colors hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-[#8cf5d0] ${
              isLibraryAppearance
                ? "text-[11px] font-extrabold text-[#f2f6ff]"
                : "text-sm font-medium text-zinc-100"
            }`}
          >
            {title}
          </Link>
        ) : (
          <h3
            className={`truncate ${
              isLibraryAppearance
                ? "text-[11px] font-extrabold text-[#f2f6ff]"
                : "text-sm font-medium text-zinc-100"
            }`}
          >
            {title}
          </h3>
        )}
        {isLibraryAppearance ? (
          <>
            <p data-game-status className="text-[9px] text-[#71849c]">
              <span>{INSTALL_STATE_LABELS[game.installState]}</span>
              <span aria-hidden="true"> · </span>
              <span>{providerLabel(game.provider)}</span>
            </p>
            {(totalPlaytimeMinutes !== undefined &&
              totalPlaytimeMinutes !== null) ||
            activityLabel !== null ? (
              <p className="truncate text-[9px] text-[#71849c]">
                {totalPlaytimeMinutes !== undefined &&
                totalPlaytimeMinutes !== null
                  ? formatPlaytimeCompact(totalPlaytimeMinutes)
                  : null}
                {totalPlaytimeMinutes !== undefined &&
                  totalPlaytimeMinutes !== null &&
                  activityLabel !== null && (
                    <span aria-hidden="true"> · </span>
                  )}
                {activityLabel}
              </p>
            ) : null}
          </>
        ) : (
          <div className="flex flex-col gap-0.5">
            {totalPlaytimeMinutes !== undefined &&
              totalPlaytimeMinutes !== null && (
                <p className="text-xs text-zinc-500">
                  {formatPlaytime(totalPlaytimeMinutes)}
                </p>
              )}
            {activityLabel !== null && (
              <p className="text-[10px] text-zinc-500">{activityLabel}</p>
            )}
          </div>
        )}
      </div>
      <div
        className={`flex flex-wrap items-center gap-2 ${
          isLibraryAppearance ? "sr-only" : ""
        }`}
      >
        {!isLibraryAppearance && (
          <span className="inline-flex w-fit items-center rounded bg-[#111b2d] px-1.5 py-0.5 text-[10px] font-medium text-[#9eabc0]">
            {providerLabel(game.provider)}
          </span>
        )}
        {enrichmentLabel !== undefined && (
          <span className="inline-flex items-center gap-1 text-[10px] text-zinc-500">
            <span
              aria-hidden="true"
              className="h-1.5 w-1.5 rounded-full bg-zinc-500"
            />
            {enrichmentLabel}
          </span>
        )}
      </div>
      <div
        className={
          isLibraryAppearance
            ? "pointer-events-none absolute inset-x-2 top-2 flex justify-end opacity-0 transition-opacity group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100"
            : "mt-auto"
        }
      >
        {action}
      </div>
    </article>
  );
}
