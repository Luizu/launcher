import { useState } from "react";
import { Link } from "react-router-dom";
import type { EnrichmentStatus } from "@launcher/contracts";
import { selectSelectorCover, titleInitials } from "../../lib/media-fallback";
import { providerLabel } from "../../lib/provider-label";
import type { LauncherGame } from "../../lib/merge-library";
import { ActionButton } from "../button/action-button";
import { InstallStatus } from "../status/install-status";

export interface GameCardProps {
  game: LauncherGame;
  /** Dispatches a launch for an installed game; wired by `useGameActions`. */
  onLaunch?: (game: LauncherGame) => void | Promise<void>;
  /** Requests installation for a remote not-installed game. */
  onInstall?: (game: LauncherGame) => void | Promise<void>;
  /** Opens Steam's downloads page when the install state cannot be verified. */
  onCheckSteam?: (game: LauncherGame) => void | Promise<void>;
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

/** Entry-level copy for catalog states that are not ready; nothing blocks. */
const ENRICHMENT_LABELS: Partial<Record<EnrichmentStatus, string>> = {
  pending: "Atualizando capa",
  failed: "Catálogo indisponível",
  unmatched: "Sem dados de catálogo",
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
  onLaunch,
  onInstall,
  onCheckSteam,
  scanPending = false,
}: GameCardProps) {
  const [busy, setBusy] = useState(false);

  const runAction =
    (action?: (game: LauncherGame) => void | Promise<void>) => () => {
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
  const coverUrl = selectSelectorCover(identity, game.artwork);
  const enrichmentLabel = game.enrichmentStatus
    ? ENRICHMENT_LABELS[game.enrichmentStatus]
    : undefined;

  return (
    <article className="flex min-w-0 flex-col gap-3 rounded-lg border border-zinc-800 bg-zinc-900/60 p-3">
      <div className="aspect-[3/4] w-full overflow-hidden rounded-md bg-zinc-800">
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
            className="flex h-full w-full items-center justify-center bg-gradient-to-br from-zinc-800 to-zinc-900"
          >
            <span className="text-4xl font-black tracking-tight text-zinc-600">
              {titleInitials(title)}
            </span>
          </div>
        )}
      </div>
      <div className="flex min-w-0 flex-col gap-1">
        {identity !== null ? (
          <Link
            to={`/games/${identity.id}`}
            className="truncate text-sm font-medium text-zinc-100 transition-colors hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-[#8cf5d0]"
          >
            {title}
          </Link>
        ) : (
          <h3 className="truncate text-sm font-medium text-zinc-100">{title}</h3>
        )}
        {game.playtimeMinutes !== undefined && (
          <p className="text-xs text-zinc-500">
            {formatPlaytime(game.playtimeMinutes)}
          </p>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex w-fit items-center rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] font-medium text-zinc-400">
          {providerLabel(game.provider)}
        </span>
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
      <div className="mt-auto">{action}</div>
    </article>
  );
}
