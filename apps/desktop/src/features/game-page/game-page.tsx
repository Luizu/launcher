import { useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import type { EnrichmentStatus, LocalLibrarySnapshot } from "@fuse-launcher/contracts";
import { ActionButton } from "../../components/button/action-button";
import { formatPlaytime } from "../../components/game-card/game-card";
import { InlineStatus } from "../../components/status/inline-status";
import { InstallStatus } from "../../components/status/install-status";
import {
  mergeLibrary,
  type LibraryGame,
} from "../../lib/merge-library";
import {
  selectGamePageMedia,
  titleInitials,
} from "../../lib/media-fallback";
import { providerLabel } from "../../lib/provider-label";
import type { GameActionsClientLike } from "../game-library/use-game-actions";
import { useGameActions } from "../game-library/use-game-actions";
import { ArrowLeftIcon } from "../../components/icons/app-icon";
import type { LocalLibraryClientLike } from "../local-library/local-library-client";
import { useLocalLibrary } from "../local-library/use-local-library";
import type { OpenUrl } from "../platform-connections/use-steam-connection";
import type { GamePagesClientLike } from "./game-page-client";
import { useGamePage } from "./use-game-page";

/** Merge fallback while the local snapshot is still loading or failed. */
const NO_SNAPSHOT: LocalLibrarySnapshot = { games: [], diagnostics: [] };

const PAGE_ERROR_MESSAGE = "Não foi possível carregar a página do jogo.";
const NOT_FOUND_MESSAGE = "Não encontramos este jogo.";
const NOT_FOUND_HINT =
  "O link pode estar incorreto ou a página ainda não está disponível.";
const COMMUNITY_COPY = "As comunidades chegam em breve.";

/** Entry-level copy for catalog states that are not ready; nothing blocks. */
const ENRICHMENT_LABELS: Partial<Record<EnrichmentStatus, string>> = {
  pending: "Atualizando capa",
  failed: "Catálogo indisponível",
  unmatched: "Sem dados de catálogo",
};

/** Title-derived tile for a definitive media absence; never an error. */
function DerivedMediaTile({ name }: { name: string }) {
  return (
    <div
      aria-hidden="true"
      className="flex aspect-[16/9] w-full items-center justify-center rounded-lg bg-gradient-to-br from-zinc-800 to-zinc-900"
    >
      <span className="text-6xl font-black tracking-tight text-zinc-600">
        {titleInitials(name)}
      </span>
    </div>
  );
}

/** One provider row: badge, playtime, catalog state, and its own action. */
function ProviderEntryRow({
  game,
  scanPending,
  actions,
}: {
  game: LibraryGame;
  scanPending: boolean;
  actions: ReturnType<typeof useGameActions>;
}) {
  const [busy, setBusy] = useState(false);

  const runAction =
    (action: (game: LibraryGame) => void | Promise<void>) => () => {
      if (busy) return;
      setBusy(true);
      void Promise.resolve(action(game))
        .catch(() => undefined)
        .finally(() => setBusy(false));
    };

  const action =
    scanPending ? (
      <ActionButton disabled>Verificando…</ActionButton>
    ) : game.installState === "installed" ? (
      <ActionButton
        disabled={busy || actions.isLaunching}
        onClick={runAction(actions.launch)}
      >
        Jogar
      </ActionButton>
    ) : game.installState === "not-installed" ? (
      <ActionButton
        disabled={busy || actions.isInstalling}
        onClick={runAction(actions.install)}
      >
        Instalar
      </ActionButton>
    ) : (
      <InstallStatus
        state={game.installState}
        disabled={busy || actions.isLaunching || actions.isInstalling}
        onCheckSteam={() => void actions.openSteamDownloads()}
      />
    );

  const enrichmentLabel = game.enrichmentStatus
    ? ENRICHMENT_LABELS[game.enrichmentStatus]
    : undefined;

  return (
    <li className="flex min-w-0 flex-wrap items-center gap-3 rounded-lg border border-zinc-800 bg-zinc-900/60 p-4">
      <span className="inline-flex w-fit items-center rounded bg-zinc-800 px-2 py-0.5 text-xs font-medium text-zinc-300">
        {providerLabel(game.provider)}
      </span>
      {game.playtimeMinutes !== undefined && (
        <span className="text-xs text-zinc-500">
          {formatPlaytime(game.playtimeMinutes)}
        </span>
      )}
      {enrichmentLabel !== undefined && (
        <span className="text-xs text-zinc-500">{enrichmentLabel}</span>
      )}
      <span className="ml-auto">{action}</span>
    </li>
  );
}

export interface GamePageProps {
  gamePages?: GamePagesClientLike;
  localLibrary?: LocalLibraryClientLike;
  /** Native game actions (launch/install/status); defaults to TauriClient. */
  tauri?: GameActionsClientLike;
  /** The opener plugin binding for the `Verificar na Steam` action. */
  openUrl?: OpenUrl;
}

/**
 * The game page: shared catalog identity (name, description, genres,
 * platforms, media) plus the user's provider entries as separate rows — never
 * merged — each with its own Jogar/Instalar action from the merged install
 * state. Media states are distinguished: pending enrichment shows a
 * preparing-media note, failed shows a subtle catalog-unavailable note, and a
 * definitive absence renders title-derived fallback art without error copy.
 * A structural "Comunidade" area is reserved with coming-soon copy. Media is
 * images only in this delivery: no video, no audio, nothing autoplays. The
 * identity is addressed by its stable id; an unknown id renders an actionable
 * not-found state, and Voltar returns to the previous route.
 */
export function GamePage({
  gamePages,
  localLibrary,
  tauri,
  openUrl,
}: GamePageProps) {
  const { identityId } = useParams<{ identityId: string }>();
  const navigate = useNavigate();
  const page = useGamePage({ identityId, client: gamePages });
  const local = useLocalLibrary({ client: localLibrary });
  const actions = useGameActions({ tauri, openUrl });

  const games = useMemo(() => {
    if (page.data === undefined) return [];
    // The page entries carry no catalog identity (it IS the page); the merge
    // only contributes per-provider install state from the local snapshot.
    return mergeLibrary(
      {
        connection: null,
        entries: page.data.entries.map((entry) => ({
          ...entry,
          artwork: null,
          catalogIdentity: null,
        })),
      },
      local.snapshot ?? NO_SNAPSHOT,
    );
  }, [page.data, local.snapshot]);

  const identity = page.data?.identity ?? null;
  const mediaUrl = selectGamePageMedia(identity);
  const hasPendingEntry = page.data?.entries.some(
    (entry) => entry.enrichmentStatus === "pending",
  );
  const hasFailedEntry = page.data?.entries.some(
    (entry) => entry.enrichmentStatus === "failed",
  );
  const scanPending = local.isLoading && !local.snapshot;

  return (
    <div className="flex flex-1 flex-col gap-6 overflow-y-auto px-6 pb-6 pt-[104px] max-[800px]:pt-[82px]">
      <button
        type="button"
        onClick={() => navigate(-1)}
        className="inline-flex w-fit items-center gap-1 text-sm text-zinc-400 underline-offset-4 hover:text-zinc-200 hover:underline focus:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#8cf5d0]"
      >
        <ArrowLeftIcon className="h-4 w-4" /> Voltar
      </button>

      {page.isLoading ? (
        <div
          role="status"
          aria-label="Carregando a página do jogo"
          className="flex flex-col gap-4"
        >
          <div className="aspect-[16/9] w-full animate-pulse rounded-lg bg-zinc-900/60" />
          <div className="h-8 w-2/3 animate-pulse rounded bg-zinc-900/60" />
          <div className="h-4 w-full animate-pulse rounded bg-zinc-900/60" />
          <div className="h-4 w-4/5 animate-pulse rounded bg-zinc-900/60" />
        </div>
      ) : page.notFound ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
          <p className="text-sm font-medium text-zinc-200">
            {NOT_FOUND_MESSAGE}
          </p>
          <p className="max-w-md text-sm text-zinc-500">{NOT_FOUND_HINT}</p>
          <Link
            to="/library"
            className="mt-2 inline-flex items-center justify-center rounded-md bg-[#8cf5d0] px-4 py-2 text-sm font-bold text-[#0c1422] transition-colors hover:bg-[#a5f8db] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#8cf5d0]"
          >
            Ir para a Biblioteca
          </Link>
        </div>
      ) : page.isError ? (
        <div className="flex flex-1 flex-col items-center justify-center">
          <InlineStatus tone="error" onRetry={page.refresh}>
            {PAGE_ERROR_MESSAGE}
          </InlineStatus>
        </div>
      ) : identity === null ? null : (
        <>
          <section aria-label="Identidade do jogo" className="flex flex-col gap-6">
            {mediaUrl !== null ? (
              <img
                src={mediaUrl}
                alt=""
                loading="lazy"
                decoding="async"
                className="aspect-[16/9] w-full rounded-lg object-cover"
              />
            ) : (
              <DerivedMediaTile name={identity.name} />
            )}
            {hasPendingEntry && (
              <p className="text-xs text-zinc-500">
                Preparando mídia…
              </p>
            )}
            {hasFailedEntry && (
              <p className="text-xs text-zinc-500">
                Catálogo indisponível no momento
              </p>
            )}
            <div className="flex flex-col gap-2">
              <h1 className="text-3xl font-bold tracking-tight text-white">
                {identity.name}
              </h1>
              {identity.description !== undefined &&
                identity.description !== null && (
                  <p className="max-w-2xl text-sm leading-relaxed text-zinc-300">
                    {identity.description}
                  </p>
                )}
              {identity.genres !== undefined &&
                identity.genres !== null &&
                identity.genres.length > 0 && (
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs text-zinc-500">Gêneros:</span>
                    {identity.genres.map((genre) => (
                      <span
                        key={genre}
                        className="inline-flex items-center rounded bg-zinc-800 px-2 py-0.5 text-xs text-zinc-300"
                      >
                        {genre}
                      </span>
                    ))}
                  </div>
                )}
              {identity.platforms !== undefined &&
                identity.platforms !== null &&
                identity.platforms.length > 0 && (
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs text-zinc-500">
                      Plataformas:
                    </span>
                    {identity.platforms.map((platform) => (
                      <span
                        key={platform}
                        className="inline-flex items-center rounded bg-zinc-800 px-2 py-0.5 text-xs text-zinc-300"
                      >
                        {platform}
                      </span>
                    ))}
                  </div>
                )}
            </div>
          </section>

          <section aria-label="Provedores" className="flex flex-col gap-3">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-400">
              Provedores
            </h2>
            <ul className="flex flex-col gap-2">
              {games.map((game) => (
                <ProviderEntryRow
                  key={`${game.provider}:${game.externalGameId}`}
                  game={game}
                  scanPending={scanPending}
                  actions={actions}
                />
              ))}
            </ul>
          </section>

          <section
            aria-label="Comunidade"
            className="flex flex-col gap-2 rounded-lg border border-dashed border-zinc-800 p-6"
          >
            <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-400">
              Comunidade
            </h2>
            <p className="text-sm text-zinc-500">{COMMUNITY_COPY}</p>
          </section>

          {actions.error !== null && (
            <InlineStatus tone="error" onRetry={actions.retry}>
              {actions.error}
            </InlineStatus>
          )}
        </>
      )}
    </div>
  );
}
