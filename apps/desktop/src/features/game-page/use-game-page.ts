import { useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { GamePageResponse } from "@launcher/contracts";
import { ApiClient, ApiClientError } from "../../lib/api-client";
import {
  GamePagesClient,
  type GamePagesClientLike,
} from "./game-page-client";

const defaultGamePagesClient = new GamePagesClient(new ApiClient());

function gamePageQueryKey(identityId: string) {
  return ["game-page", identityId] as const;
}

export interface UseGamePageOptions {
  identityId: string | undefined;
  client?: GamePagesClientLike;
}

/**
 * TanStack Query glue for one game page. The identity id is part of the query
 * key, so navigating between pages never reuses stale content. A 404 from the
 * API (unknown identity id) is surfaced as the `notFound` flag so the page can
 * render an actionable state; any other error is retryable.
 */
export function useGamePage({
  identityId,
  client = defaultGamePagesClient,
}: UseGamePageOptions) {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: gamePageQueryKey(identityId ?? ""),
    queryFn: () => client.getGamePage(identityId as string),
    enabled: identityId !== undefined && identityId !== "",
    retry: false,
  });

  const notFound =
    identityId === undefined ||
    identityId === "" ||
    (query.isError &&
      query.error instanceof ApiClientError &&
      query.error.status === 404);

  const refresh = useCallback(() => {
    if (identityId !== undefined && identityId !== "") {
      void queryClient.invalidateQueries({
        queryKey: gamePageQueryKey(identityId),
      });
    }
  }, [queryClient, identityId]);

  return {
    data: query.data as GamePageResponse | undefined,
    isLoading: query.isPending,
    isError: query.isError,
    notFound,
    refresh,
  };
}
