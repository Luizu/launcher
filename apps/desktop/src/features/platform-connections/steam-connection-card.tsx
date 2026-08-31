import { useEffect, useRef, useState } from "react";
import type {
  GameLibraryConnection,
  LinkAttemptStatus,
  StartPlatformLinkResponse,
  SyncLibraryResult,
} from "@fuse-launcher/contracts";
import { ActionButton } from "../../components/button/action-button";
import { InlineStatus } from "../../components/status/inline-status";

/**
 * Link attempt lifecycle phases. The card owns the state machine so the
 * pinned plan test can drive it with injected functions and no query
 * provider; the TanStack glue in `use-steam-connection.ts` supplies the
 * functions and the library state.
 */
type LinkPhase =
  | "idle"
  | "waiting"
  | "completed"
  | "expired"
  | "failed"
  | "timeout"
  | "error";

export interface SteamConnectionCardProps {
  /** Starts a Steam link attempt (POST /api/platform-connections/steam/link). */
  startLink: () => Promise<StartPlatformLinkResponse>;
  /** Opens the authorization URL in the external browser (opener plugin). */
  openUrl: (url: string) => Promise<void>;
  /** Reads the attempt status; drives the 2s polling when present. */
  getLinkStatus?: (attemptId: string) => Promise<LinkAttemptStatus>;
  /** Current library connection state, or null when not connected. */
  connection?: GameLibraryConnection | null;
  /** True when the library status itself could not be fetched. */
  libraryUnavailable?: boolean;
  /** Synchronizes the library (POST /api/game-library/sync). */
  onSync?: () => Promise<SyncLibraryResult>;
  /** Re-fetches the library status after a failure. */
  onRefreshLibrary?: () => void;
  /** Called once when the link attempt completes (invalidates the library). */
  onConnected?: () => void;
  pollIntervalMs?: number;
  timeoutMs?: number;
}

const DEFAULT_POLL_INTERVAL_MS = 2000;
const DEFAULT_TIMEOUT_MS = 2 * 60 * 1000;

const CONFIRMATION_FAILED = "Não foi possível confirmar a conexão com a Steam.";
const START_FAILED = "Não foi possível iniciar a conexão com a Steam.";
const SYNC_FAILED = "Não foi possível sincronizar a biblioteca.";
const LIBRARY_UNAVAILABLE = "Não foi possível verificar sua biblioteca.";
const LIBRARY_STALE = "Não foi possível atualizar sua biblioteca.";

/**
 * Formats the API's `lastSyncedAt` as a compact pt-BR date/time in the local
 * timezone, or null when the value is absent or unparsable (nothing renders).
 */
function formatLastSyncedAt(value: string): string | null {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(date);
}

/**
 * Only HTTPS URLs may be handed to the opener plugin (the client-side choke
 * point for opening external URLs). Anything else — http, empty, malformed —
 * is rejected before it reaches the browser opener.
 */
function isHttpsUrl(url: string): boolean {
  try {
    return new URL(url).protocol === "https:";
  } catch {
    return false;
  }
}

type ConnectionView =
  | { kind: "private" }
  | { kind: "unavailable" }
  | { kind: "failed" }
  | { kind: "never" }
  | { kind: "syncing" }
  | { kind: "synced" };

function connectionView(
  connection: GameLibraryConnection | null | undefined,
): ConnectionView | null {
  if (!connection) return null;
  if (connection.visibility === "private") return { kind: "private" };
  // An unavailable account also reports syncStatus "failed"; visibility wins
  // so the two causes stay distinguishable.
  if (connection.visibility === "unavailable") return { kind: "unavailable" };
  if (connection.syncStatus === "failed") return { kind: "failed" };
  if (connection.syncStatus === "syncing") return { kind: "syncing" };
  if (connection.syncStatus === "synced") return { kind: "synced" };
  return { kind: "never" };
}

/**
 * Steam connection control: links the account through the external browser,
 * polls the link attempt every 2s for up to 2 minutes, stops on terminal
 * states, and presents sync/retry actions for the library states. Raw attempt
 * IDs and provider errors never reach the primary UI.
 */
export function SteamConnectionCard({
  startLink,
  openUrl,
  getLinkStatus,
  connection,
  libraryUnavailable = false,
  onSync,
  onRefreshLibrary,
  onConnected,
  pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
  timeoutMs = DEFAULT_TIMEOUT_MS,
}: SteamConnectionCardProps) {
  const [phase, setPhase] = useState<LinkPhase>("idle");
  const [attemptId, setAttemptId] = useState<string | null>(null);
  const [authorizationUrl, setAuthorizationUrl] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncFailed, setSyncFailed] = useState(false);
  const cancelRef = useRef(false);

  const handleStart = async () => {
    if (starting) return;
    cancelRef.current = false;
    setStarting(true);
    setSyncFailed(false);
    setPhase("waiting");
    try {
      const { attemptId: nextAttemptId, authorizationUrl: url } =
        await startLink();
      if (cancelRef.current) return;
      if (!isHttpsUrl(url)) {
        // Never open a non-HTTPS or malformed URL; surface a retryable error.
        setAttemptId(null);
        setAuthorizationUrl(null);
        setPhase("error");
        return;
      }
      setAttemptId(nextAttemptId);
      setAuthorizationUrl(url);
      await openUrl(url);
    } catch {
      if (!cancelRef.current) {
        setAttemptId(null);
        setAuthorizationUrl(null);
        setPhase("error");
      }
    } finally {
      setStarting(false);
    }
  };

  const handleCancel = () => {
    cancelRef.current = true;
    setAttemptId(null);
    setAuthorizationUrl(null);
    setPhase("idle");
  };

  const handleReturnToSteam = () => {
    if (authorizationUrl) {
      void openUrl(authorizationUrl);
    }
  };

  const handleSync = async () => {
    if (!onSync || syncing) return;
    setSyncing(true);
    setSyncFailed(false);
    try {
      await onSync();
    } catch {
      setSyncFailed(true);
    } finally {
      setSyncing(false);
    }
  };

  useEffect(() => {
    if (phase !== "waiting" || attemptId === null || getLinkStatus === undefined) {
      return;
    }

    let stopped = false;
    const startedAt = Date.now();

    const tick = async () => {
      if (stopped) return;
      if (Date.now() - startedAt >= timeoutMs) {
        setPhase("timeout");
        return;
      }
      try {
        const status = await getLinkStatus(attemptId);
        if (stopped) return;
        if (status.status === "completed") {
          setPhase("completed");
          onConnected?.();
        } else if (status.status === "expired") {
          setPhase("expired");
        } else if (status.status === "failed") {
          setPhase("failed");
        }
      } catch {
        // A transient polling failure is not terminal; keep polling until
        // the attempt completes, expires, or the deadline passes.
      }
    };

    const interval = setInterval(() => {
      void tick();
    }, pollIntervalMs);
    return () => {
      stopped = true;
      clearInterval(interval);
    };
  }, [phase, attemptId, getLinkStatus, pollIntervalMs, timeoutMs, onConnected]);

  const view = connectionView(connection);
  const lastSyncedAt = connection?.lastSyncedAt;
  const lastSyncedLabel =
    lastSyncedAt != null ? formatLastSyncedAt(lastSyncedAt) : null;

  if (phase === "waiting") {
    return (
      <section
        role="status"
        className="w-full max-w-md rounded-2xl border border-white/10 bg-[#0b1322]/80 p-6 shadow-2xl"
      >
        <h2 className="text-lg font-semibold tracking-tight">Steam</h2>
        <p className="mt-1 text-sm text-zinc-300">Aguardando confirmação da Steam</p>
        <div className="mt-4 flex gap-2">
          {authorizationUrl && (
            <ActionButton variant="secondary" onClick={handleReturnToSteam}>
              Voltar para a Steam
            </ActionButton>
          )}
          <ActionButton variant="secondary" onClick={handleCancel}>
            Cancelar
          </ActionButton>
        </div>
      </section>
    );
  }

  if (phase === "error" || phase === "timeout" || phase === "expired" || phase === "failed") {
    const message =
      phase === "error" ? START_FAILED : CONFIRMATION_FAILED;
    return (
      <section className="w-full max-w-md rounded-2xl border border-white/10 bg-[#0b1322]/80 p-6 shadow-2xl">
        <h2 className="text-lg font-semibold tracking-tight">Steam</h2>
        <InlineStatus tone="error" onRetry={() => void handleStart()}>
          {message}
        </InlineStatus>
      </section>
    );
  }

  if (!view) {
    if (libraryUnavailable) {
      // A completed link whose library refetch failed must not dead-end on
      // "Carregando a biblioteca…"; offer a refresh/retry instead.
      return (
        <section className="w-full max-w-md rounded-2xl border border-white/10 bg-[#0b1322]/80 p-6 shadow-2xl">
          <h2 className="text-lg font-semibold tracking-tight">Steam</h2>
          <InlineStatus tone="error" onRetry={onRefreshLibrary}>
            {LIBRARY_UNAVAILABLE}
          </InlineStatus>
        </section>
      );
    }

    if (phase === "completed") {
      // Brief in-flight state while the invalidation-triggered library
      // refetch lands; if that refetch errors, the branch above takes over.
      return (
        <section
          role="status"
          className="w-full max-w-md rounded-2xl border border-white/10 bg-[#0b1322]/80 p-6 shadow-2xl"
        >
          <h2 className="text-lg font-semibold tracking-tight">Steam</h2>
          <p className="mt-1 text-sm text-zinc-300">
            Conectado à Steam. Carregando a biblioteca…
          </p>
        </section>
      );
    }

    return (
      <section className="w-full max-w-md rounded-2xl border border-white/10 bg-[#0b1322]/80 p-6 shadow-2xl">
        <h2 className="text-lg font-semibold tracking-tight">Steam</h2>
        <p className="mt-1 text-sm text-zinc-300">Steam não conectada</p>
        <div className="mt-4">
          <ActionButton disabled={starting} onClick={() => void handleStart()}>
            {starting ? "Conectando…" : "Conectar Steam"}
          </ActionButton>
        </div>
      </section>
    );
  }

  if (syncFailed) {
    return (
      <section className="w-full max-w-md rounded-2xl border border-white/10 bg-[#0b1322]/80 p-6 shadow-2xl">
        <h2 className="text-lg font-semibold tracking-tight">Steam</h2>
        <InlineStatus tone="error" onRetry={() => void handleSync()}>
          {SYNC_FAILED}
        </InlineStatus>
      </section>
    );
  }

  if (view.kind === "private") {
    return (
      <section className="w-full max-w-md rounded-2xl border border-white/10 bg-[#0b1322]/80 p-6 shadow-2xl">
        <h2 className="text-lg font-semibold tracking-tight">Steam</h2>
        <p className="mt-1 text-sm text-zinc-300">
          Conta conectada; biblioteca indisponível
        </p>
        <div className="mt-4">
          <ActionButton variant="secondary" onClick={() => void handleSync()}>
            Tentar novamente
          </ActionButton>
        </div>
      </section>
    );
  }

  if (view.kind === "failed") {
    // The last sync failed but the account is public: the stored snapshot is
    // stale, so show the last-sync time next to the failure instead of
    // presenting the list as current.
    return (
      <section className="w-full max-w-md rounded-2xl border border-white/10 bg-[#0b1322]/80 p-6 shadow-2xl">
        <h2 className="text-lg font-semibold tracking-tight">Steam</h2>
        <p className="mt-1 text-sm text-zinc-300">{LIBRARY_STALE}</p>
        {lastSyncedLabel !== null && (
          <p className="mt-1 text-xs text-zinc-500">
            Última sincronização: {lastSyncedLabel}
          </p>
        )}
        <div className="mt-4">
          <ActionButton onClick={() => void handleSync()}>Tentar novamente</ActionButton>
        </div>
      </section>
    );
  }

  if (view.kind === "unavailable") {
    return (
      <section className="w-full max-w-md rounded-2xl border border-white/10 bg-[#0b1322]/80 p-6 shadow-2xl">
        <h2 className="text-lg font-semibold tracking-tight">Steam</h2>
        <p className="mt-1 text-sm text-zinc-300">
          Sua biblioteca Steam está indisponível.
        </p>
        <div className="mt-4">
          <ActionButton onClick={() => void handleSync()}>Tentar novamente</ActionButton>
        </div>
      </section>
    );
  }

  if (view.kind === "syncing") {
    return (
      <section
        role="status"
        className="w-full max-w-md rounded-2xl border border-white/10 bg-[#0b1322]/80 p-6 shadow-2xl"
      >
        <h2 className="text-lg font-semibold tracking-tight">Steam</h2>
        <p className="mt-1 text-sm text-zinc-300">Sincronizando biblioteca…</p>
        <div className="mt-4">
          <ActionButton disabled>Sincronizando…</ActionButton>
        </div>
      </section>
    );
  }

  if (view.kind === "synced") {
    return (
      <section className="w-full max-w-md rounded-2xl border border-white/10 bg-[#0b1322]/80 p-6 shadow-2xl">
        <h2 className="text-lg font-semibold tracking-tight">Steam</h2>
        <p className="mt-1 text-sm text-zinc-300">Sincronizada</p>
        {lastSyncedLabel !== null && (
          <p className="mt-1 text-xs text-zinc-500">
            Última sincronização: {lastSyncedLabel}
          </p>
        )}
        <div className="mt-4">
          <ActionButton disabled={syncing} onClick={() => void handleSync()}>
            {syncing ? "Sincronizando…" : "Atualizar biblioteca"}
          </ActionButton>
        </div>
      </section>
    );
  }

  return (
    <section className="w-full max-w-md rounded-2xl border border-white/10 bg-[#0b1322]/80 p-6 shadow-2xl">
      <h2 className="text-lg font-semibold tracking-tight">Steam</h2>
      <p className="mt-1 text-sm text-zinc-300">Conectada, nunca sincronizada</p>
      <div className="mt-4">
        <ActionButton disabled={syncing} onClick={() => void handleSync()}>
          {syncing ? "Sincronizando…" : "Sincronizar biblioteca"}
        </ActionButton>
      </div>
    </section>
  );
}
