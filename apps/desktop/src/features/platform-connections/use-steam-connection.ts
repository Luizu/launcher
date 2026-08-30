import { useCallback } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiClient } from "../../lib/api-client";
import { GameLibraryClient, type GameLibraryClientLike } from "../game-library/game-library-client";
import {
  defaultSyncCoordinator,
  SyncCoordinator,
} from "../game-library/sync-cycle/sync-coordinator";
import {
  PlatformConnectionsClient,
  type PlatformConnectionsClientLike,
} from "./platform-connections-client";
import type { SteamConnectionCardProps } from "./steam-connection-card";

/** The opener binding shape; the Tauri plugin's `openUrl` satisfies it. */
export type OpenUrl = (url: string) => Promise<void>;

export const GAME_LIBRARY_QUERY_KEY = ["game-library"] as const;

const defaultPlatformConnectionsClient = new PlatformConnectionsClient(
  new ApiClient(),
);
const defaultGameLibraryClient = new GameLibraryClient(new ApiClient());

export interface UseSteamConnectionOptions {
  client?: PlatformConnectionsClientLike;
  gameLibrary?: GameLibraryClientLike;
  /** Coordinator shared with the sync cycle so manual retries deduplicate
   * against open/focus/periodic triggers for the same provider. */
  syncCoordinator?: SyncCoordinator;
  openUrl: OpenUrl;
}

/**
 * TanStack Query glue for the Steam connection flow. Owns the library query
 * (remote connection state), the sync mutation, and the invalidation of the
 * library query when a link attempt completes or a sync lands. The
 * `SteamConnectionCard` state machine runs on the returned props, which are
 * injectable for tests.
 */
export function useSteamConnection({
  client = defaultPlatformConnectionsClient,
  gameLibrary = defaultGameLibraryClient,
  syncCoordinator = defaultSyncCoordinator,
  openUrl,
}: UseSteamConnectionOptions): SteamConnectionCardProps {
  const queryClient = useQueryClient();

  const libraryQuery = useQuery({
    queryKey: GAME_LIBRARY_QUERY_KEY,
    queryFn: () => gameLibrary.list(),
  });

  // Manual retries route through the same coordinator as the sync cycle:
  // concurrent triggers for the same provider coalesce onto one in-flight
  // request instead of double-firing. The invalidation lives with the
  // request, so it runs exactly once per actual sync.
  const syncMutation = useMutation({
    mutationFn: () => {
      const provider = libraryQuery.data?.connection?.provider ?? "steam";
      return syncCoordinator.sync(provider, async () => {
        const result = await gameLibrary.sync();
        void queryClient.invalidateQueries({ queryKey: GAME_LIBRARY_QUERY_KEY });
        return result;
      });
    },
  });

  const refreshLibrary = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: GAME_LIBRARY_QUERY_KEY });
  }, [queryClient]);

  const startLink = useCallback(
    () => client.startSteamLink(),
    [client],
  );

  const getLinkStatus = useCallback(
    (attemptId: string) => client.getSteamLinkStatus(attemptId),
    [client],
  );

  return {
    startLink,
    openUrl,
    getLinkStatus,
    connection: libraryQuery.data?.connection ?? null,
    libraryUnavailable: libraryQuery.isError,
    onSync: () => syncMutation.mutateAsync(),
    onRefreshLibrary: refreshLibrary,
    onConnected: refreshLibrary,
  };
}
