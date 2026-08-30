import { useQuery } from "@tanstack/react-query";
import type { LaunchHistoryEntry } from "@launcher/contracts";
import { TauriClient } from "../../lib/tauri-client";
import { LaunchHistoryClient, type LaunchHistoryClientLike } from "./launch-history-client";

/** Query key for the desktop-local launch history. */
export const LAUNCH_HISTORY_QUERY_KEY = ["launch-history"] as const;

const EMPTY_ENTRIES: LaunchHistoryEntry[] = [];

const defaultLaunchHistoryClient = new LaunchHistoryClient(new TauriClient());

/**
 * Joins history entries into the `provider:externalGameId` game key used by
 * the Home ranking, keeping the last recorded instant per game.
 */
export function launchHistoryToMap(
  entries: ReadonlyArray<LaunchHistoryEntry>,
): Record<string, string> {
  const byKey: Record<string, string> = {};
  for (const entry of entries) {
    const key = `${entry.provider}:${entry.externalGameId}`;
    const previous = byKey[key];
    if (previous === undefined || entry.lastLaunchedAt > previous) {
      byKey[key] = entry.lastLaunchedAt;
    }
  }
  return byKey;
}

export interface UseLaunchHistoryOptions {
  /** The history source; defaults to the Tauri client. */
  client?: LaunchHistoryClientLike;
}

/**
 * Loads the desktop-local launch history through TanStack Query. The history
 * is read via Tauri IPC only and is never sent to any API.
 */
export function useLaunchHistory({
  client = defaultLaunchHistoryClient,
}: UseLaunchHistoryOptions = {}) {
  const query = useQuery({
    queryKey: LAUNCH_HISTORY_QUERY_KEY,
    queryFn: () => client.getHistory(),
    staleTime: Infinity,
  });

  return {
    entries: query.data?.entries ?? EMPTY_ENTRIES,
    history: launchHistoryToMap(query.data?.entries ?? EMPTY_ENTRIES),
  };
}
