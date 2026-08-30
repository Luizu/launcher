import { useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { TauriClient } from "../../lib/tauri-client";
import {
  LocalLibraryClient,
  type LocalLibraryClientLike,
} from "./local-library-client";

/** Shared query key so any component can invalidate the scan result. */
export const LOCAL_LIBRARY_QUERY_KEY = ["local-library"] as const;

const defaultLocalLibraryClient = new LocalLibraryClient(new TauriClient());

export interface UseLocalLibraryOptions {
  client?: LocalLibraryClientLike;
}

/**
 * TanStack Query glue for the local Steam snapshot. One scan runs on mount;
 * the result is cached with `staleTime: Infinity` so a re-render never
 * triggers another scan — the user has to press `Atualizar` (or the query
 * must be invalidated by an install/launch action) to rescan.
 */
export function useLocalLibrary({
  client = defaultLocalLibraryClient,
}: UseLocalLibraryOptions = {}) {
  const queryClient = useQueryClient();

  const scanQuery = useQuery({
    queryKey: LOCAL_LIBRARY_QUERY_KEY,
    queryFn: () => client.scan(),
    staleTime: Infinity,
    // The scan is only meaningful on mount and via the explicit refresh: an
    // errored scan (e.g. Steam not installed) must not re-run on every window
    // focus (TanStack Query v5 refetches errored queries on focus by default),
    // and the global retry default (3) would amplify the storm; one boot
    // retry is enough.
    refetchOnWindowFocus: false,
    retry: 1,
  });

  const refresh = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: LOCAL_LIBRARY_QUERY_KEY });
  }, [queryClient]);

  return {
    snapshot: scanQuery.data,
    isLoading: scanQuery.isPending,
    isError: scanQuery.isError,
    refresh,
  };
}
