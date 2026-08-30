import { useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiClient } from "../../lib/api-client";
import { GAME_LIBRARY_QUERY_KEY } from "../platform-connections/use-steam-connection";
import {
  GameLibraryClient,
  type GameLibraryClientLike,
} from "./game-library-client";

const defaultGameLibraryClient = new GameLibraryClient(new ApiClient());

export interface UseGameLibraryOptions {
  gameLibrary?: GameLibraryClientLike;
}

/**
 * TanStack Query glue for the remote library. Shares the Task 4
 * `GAME_LIBRARY_QUERY_KEY` with `useSteamConnection` so the connection card
 * and this hook observe one query: a refetch or invalidation updates them
 * both. The sync action lives on the connection card (which owns the sync
 * state machine and its invalidation); freshness comes from the API's
 * `lastSyncedAt` and that explicit sync action. Nothing here fetches on
 * every render.
 */
export function useGameLibrary({
  gameLibrary = defaultGameLibraryClient,
}: UseGameLibraryOptions = {}) {
  const queryClient = useQueryClient();

  const libraryQuery = useQuery({
    queryKey: GAME_LIBRARY_QUERY_KEY,
    queryFn: () => gameLibrary.list(),
  });

  const refresh = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: GAME_LIBRARY_QUERY_KEY });
  }, [queryClient]);

  return {
    data: libraryQuery.data,
    connection: libraryQuery.data?.connection ?? null,
    entries: libraryQuery.data?.entries ?? [],
    isLoading: libraryQuery.isPending,
    isError: libraryQuery.isError,
    refresh,
  };
}
