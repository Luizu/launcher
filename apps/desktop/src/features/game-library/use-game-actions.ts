import { useCallback, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type {
  ActionAccepted,
  InstallStatus,
  LocalInstallState,
  LocalLibrarySnapshot,
} from "@fuse-launcher/contracts";
import type { LibraryGame } from "../../lib/merge-library";
import { TauriClient } from "../../lib/tauri-client";
import { LAUNCH_HISTORY_QUERY_KEY } from "../launch-history/use-launch-history";
import { LOCAL_LIBRARY_QUERY_KEY } from "../local-library/use-local-library";
import type { OpenUrl } from "../platform-connections/use-steam-connection";

/** Poll cadence for a requested installation. */
const POLL_INTERVAL_MS = 3_000;

/** Hard bound on the installation poll (~5 minutes). */
const MAX_POLL_MS = 5 * 60 * 1_000;

/** Steam's own downloads page, opened when the state cannot be verified. */
const STEAM_DOWNLOADS_URL = "steam://open/downloads";

/**
 * Sentinel key for the opener action in the per-AppID pending set: the Steam
 * downloads page is not a game, but the duplicate-click guard still applies.
 */
const OPENER_PENDING_KEY = -1;

/** Human PT-BR copy for the native error codes the game commands can emit. */
const NATIVE_ERROR_MESSAGES: Record<string, string> = {
  "game-not-installed":
    "Este jogo não está instalado no computador. Atualize a biblioteca e tente novamente.",
  "invalid-app-id": "Não foi possível identificar este jogo na Steam.",
  "open-failed":
    "A Steam não abriu. Verifique se ela está em execução e tente novamente.",
  "steam-not-installed": "A Steam não foi encontrada neste computador.",
  "steam-path-not-found": "A instalação da Steam não foi encontrada.",
  "status-refresh-failed": "Não foi possível verificar o estado da instalação.",
  "install-state-unknown": "Não foi possível verificar o estado da instalação.",
  "native-command-failed":
    "Não foi possível concluir a ação na Steam. Tente novamente.",
};

const FALLBACK_ACTION_ERROR =
  "Não foi possível concluir a ação na Steam. Tente novamente.";
const OPENER_ERROR = "Não foi possível abrir a página da Steam.";

/**
 * The slice of {@link TauriClient} the game actions need, exposed so the
 * hook and tests can inject fakes.
 */
export interface GameActionsClientLike {
  launch(appId: number): Promise<ActionAccepted>;
  install(appId: number): Promise<ActionAccepted>;
  getInstallStatus(appId: number): Promise<InstallStatus>;
}

const defaultTauriClient = new TauriClient();

/** A game id is actionable only when it is a positive integer Steam AppID. */
function toNumericAppId(game: LibraryGame): number | null {
  if (game.provider !== "steam") return null;
  const id = Number(game.externalGameId);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

/** Maps a native command failure to PT-BR copy by its stable error code. */
function toHumanError(error: unknown): string {
  if (typeof error === "object" && error !== null) {
    const candidate = error as { code?: unknown };
    const message =
      typeof candidate.code === "string"
        ? NATIVE_ERROR_MESSAGES[candidate.code]
        : undefined;
    if (message !== undefined) return message;
  }
  return FALLBACK_ACTION_ERROR;
}

interface PollHandle {
  timer: ReturnType<typeof setTimeout>;
  appId: number;
  /** Timestamp of the last status this poll wrote to the snapshot. */
  lastWriteAt: number;
}

type LastAction =
  | { kind: "launch"; game: LibraryGame }
  | { kind: "install"; game: LibraryGame }
  | { kind: "open-steam" };

export interface UseGameActionsOptions {
  /** Native client; defaults to the real {@link TauriClient}. */
  tauri?: GameActionsClientLike;
  /** The opener plugin binding for the `Verificar na Steam` action. */
  openUrl?: OpenUrl;
}

export interface UseGameActionsResult {
  /** Launches a local installed game; guarded in the hook, not only the UI. */
  launch(game: LibraryGame): Promise<void>;
  /** Requests installation for a Steam remote entry with a numeric AppID. */
  install(game: LibraryGame): Promise<void>;
  /** Refreshes one game's native install state into the local snapshot. */
  refreshInstallStatus(game: LibraryGame): Promise<void>;
  /** Opens Steam's downloads page (recovery for the `unknown` state). */
  openSteamDownloads(): Promise<void>;
  isLaunching: boolean;
  isInstalling: boolean;
  /** Single inline action error with {@link UseGameActionsResult.retry}. */
  error: string | null;
  /** Re-runs the last failed action (launch, install, or Steam downloads). */
  retry(): void;
}

/**
 * Wire for launch, install, and install-status tracking.
 *
 * `launch` calls `TauriClient.launch` only for a local `installed` game;
 * `install` calls `TauriClient.install` only for a Steam remote entry with a
 * numeric AppID — both guarded here, not just in the UI. After an install is
 * accepted the local library query is invalidated, the game is optimistically
 * marked `installing` in the local snapshot, and a three-second
 * `getInstallStatus` poll starts for that AppID: it writes each result into
 * the snapshot (the merged list follows it), stops on the native terminal
 * states `installed`/`unknown`, honors a fresher scan that reports
 * `installed`, `unknown`, or `not-installed` (game gone) for the game, and is
 * bounded by {@link MAX_POLL_MS}. Polls for distinct games run independently
 * (installing game B never stops game A's poll). Failures surface as one
 * inline error with a retry action; duplicate clicks are ignored only while
 * the same game's action is pending — actions on different games may run
 * concurrently. Retry re-runs the last failed action; a guard refusal (e.g. a
 * stale card) re-checks the guard and shows the same message again.
 */
export function useGameActions({
  tauri = defaultTauriClient,
  openUrl,
}: UseGameActionsOptions = {}): UseGameActionsResult {
  const queryClient = useQueryClient();
  const [launching, setLaunching] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** AppIDs with an action in flight; keyed per game, not global. */
  const pendingRef = useRef<Set<number>>(new Set());
  const lastAction = useRef<LastAction | null>(null);
  /** One poll per AppID so installs of different games run concurrently. */
  const pollsRef = useRef<Map<number, PollHandle>>(new Map());

  /** Writes a native install state into the cached local snapshot. */
  const applyLocalState = useCallback(
    (game: LibraryGame, state: LocalInstallState) => {
      const appId = toNumericAppId(game);
      if (appId === null) return;
      const snapshot = queryClient.getQueryData<LocalLibrarySnapshot>(
        LOCAL_LIBRARY_QUERY_KEY,
      );
      if (snapshot === undefined) return;
      const games = snapshot.games.map((localGame) =>
        localGame.externalGameId === appId ? { ...localGame, state } : localGame,
      );
      if (!games.some((localGame) => localGame.externalGameId === appId)) {
        games.push({
          provider: "steam",
          externalGameId: appId,
          name: game.name,
          state,
        });
      }
      queryClient.setQueryData(LOCAL_LIBRARY_QUERY_KEY, { ...snapshot, games });
    },
    [queryClient],
  );

  const stopPolling = useCallback((appId: number) => {
    const poll = pollsRef.current.get(appId);
    if (poll !== undefined) {
      clearTimeout(poll.timer);
      pollsRef.current.delete(appId);
    }
  }, []);

  const startPolling = useCallback(
    (game: LibraryGame, appId: number) => {
      const deadline = Date.now() + MAX_POLL_MS;
      const tick = async () => {
        if (!pollsRef.current.has(appId)) return;
        if (Date.now() >= deadline) {
          stopPolling(appId);
          return;
        }
        // A fresh scan is the local truth: when it reports installed,
        // unknown, or not-installed (game gone) for the polled game, stop
        // and keep the scan's state instead of the poll's.
        const poll = pollsRef.current.get(appId);
        if (poll !== undefined && poll.lastWriteAt > 0) {
          const state = queryClient.getQueryState<LocalLibrarySnapshot>(
            LOCAL_LIBRARY_QUERY_KEY,
          );
          if (
            state !== undefined &&
            state.dataUpdatedAt > poll.lastWriteAt
          ) {
            const localGame = state.data?.games.find(
              (candidate) => candidate.externalGameId === appId,
            );
            if (localGame === undefined || localGame.state !== "installing") {
              stopPolling(appId);
              return;
            }
          }
        }
        let status: InstallStatus;
        try {
          status = await tauri.getInstallStatus(appId);
        } catch {
          // Transient native failure (e.g. Steam mid-launch): keep polling
          // until the bound.
          if (pollsRef.current.has(appId)) {
            pollsRef.current.get(appId)!.timer = setTimeout(
              tick,
              POLL_INTERVAL_MS,
            );
          }
          return;
        }
        if (!pollsRef.current.has(appId)) return;
        applyLocalState(game, status.state);
        const current = pollsRef.current.get(appId);
        if (current !== undefined) current.lastWriteAt = Date.now();
        if (status.state === "installed" || status.state === "unknown") {
          stopPolling(appId);
          return;
        }
        const next = pollsRef.current.get(appId);
        if (next !== undefined) next.timer = setTimeout(tick, POLL_INTERVAL_MS);
      };
      pollsRef.current.set(appId, {
        timer: setTimeout(tick, POLL_INTERVAL_MS),
        appId,
        lastWriteAt: 0,
      });
    },
    [applyLocalState, queryClient, stopPolling, tauri],
  );

  const launch = useCallback(
    async (game: LibraryGame): Promise<void> => {
      if (game.installState !== "installed") {
        lastAction.current = { kind: "launch", game };
        setError(NATIVE_ERROR_MESSAGES["game-not-installed"]);
        return;
      }
      const appId = toNumericAppId(game);
      if (appId === null) {
        lastAction.current = { kind: "launch", game };
        setError(NATIVE_ERROR_MESSAGES["invalid-app-id"]);
        return;
      }
      if (pendingRef.current.has(appId)) return;
      pendingRef.current.add(appId);
      setLaunching(true);
      setError(null);
      lastAction.current = { kind: "launch", game };
      try {
        await tauri.launch(appId);
        // The launch writes a new local history entry; the Home ranks by it.
        void queryClient.invalidateQueries(
          { queryKey: LAUNCH_HISTORY_QUERY_KEY },
          // The refetch can fail (e.g. the history file is unreadable); the
          // launch flow must not reject because of it.
          { throwOnError: false },
        );
      } catch (launchError) {
        setError(toHumanError(launchError));
      } finally {
        pendingRef.current.delete(appId);
        setLaunching(false);
      }
    },
    [queryClient, tauri],
  );

  const install = useCallback(
    async (game: LibraryGame): Promise<void> => {
      if (game.installState !== "not-installed") {
        lastAction.current = { kind: "install", game };
        setError("Não foi possível iniciar a instalação deste jogo.");
        return;
      }
      const appId = toNumericAppId(game);
      if (appId === null) {
        lastAction.current = { kind: "install", game };
        setError(NATIVE_ERROR_MESSAGES["invalid-app-id"]);
        return;
      }
      if (pendingRef.current.has(appId)) return;
      pendingRef.current.add(appId);
      setInstalling(true);
      setError(null);
      lastAction.current = { kind: "install", game };
      try {
        await tauri.install(appId);
        applyLocalState(game, "installing");
        void queryClient.invalidateQueries(
          { queryKey: LOCAL_LIBRARY_QUERY_KEY },
          // The refetch can fail (e.g. Steam closed right after install);
          // the install flow must not reject because of it.
          { throwOnError: false },
        );
        startPolling(game, appId);
      } catch (installError) {
        setError(toHumanError(installError));
      } finally {
        pendingRef.current.delete(appId);
        setInstalling(false);
      }
    },
    [applyLocalState, queryClient, startPolling, tauri],
  );

  const refreshInstallStatus = useCallback(
    async (game: LibraryGame): Promise<void> => {
      const appId = toNumericAppId(game);
      if (appId === null || pendingRef.current.has(appId)) return;
      pendingRef.current.add(appId);
      try {
        const status = await tauri.getInstallStatus(appId);
        applyLocalState(game, status.state);
      } catch {
        // Passive refresh: transient native failures are tolerated; the
        // install poll and the explicit refresh action are the recovery
        // paths.
      } finally {
        pendingRef.current.delete(appId);
      }
    },
    [applyLocalState, tauri],
  );

  const openSteamDownloads = useCallback(async (): Promise<void> => {
    if (openUrl === undefined || pendingRef.current.has(OPENER_PENDING_KEY)) {
      return;
    }
    pendingRef.current.add(OPENER_PENDING_KEY);
    setError(null);
    lastAction.current = { kind: "open-steam" };
    try {
      await openUrl(STEAM_DOWNLOADS_URL);
    } catch {
      setError(OPENER_ERROR);
    } finally {
      pendingRef.current.delete(OPENER_PENDING_KEY);
    }
  }, [openUrl]);

  const retry = useCallback(() => {
    const last = lastAction.current;
    if (last === null) return;
    if (last.kind === "launch") void launch(last.game);
    else if (last.kind === "install") void install(last.game);
    else void openSteamDownloads();
  }, [install, launch, openSteamDownloads]);

  useEffect(
    () => () => {
      for (const poll of pollsRef.current.values()) clearTimeout(poll.timer);
      pollsRef.current.clear();
    },
    [],
  );

  return {
    launch,
    install,
    refreshInstallStatus,
    openSteamDownloads,
    isLaunching: launching,
    isInstalling: installing,
    error,
    retry,
  };
}
