import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { listen as tauriListen } from "@tauri-apps/api/event";
import type { LocalLibrarySnapshot } from "@fuse-launcher/contracts";
import { isTauriRuntime } from "../../lib/http-fetcher";
import { LOCAL_LIBRARY_QUERY_KEY } from "./use-local-library";

/** Event emitted by the native Steam watcher after a relevant change. */
export const LOCAL_LIBRARY_CHANGED_EVENT = "local-library-changed";

/**
 * The `listen` seam: the @tauri-apps/api/event binding (which requires the
 * Tauri runtime) is constructor-injected so tests pass a fake.
 */
export type EventListen = <T>(
  event: string,
  handler: (event: { payload: T }) => void,
) => Promise<() => void>;

/**
 * Subscribes to the native Steam watcher's `local-library-changed` event and
 * writes each fresh snapshot into the local library cache, so installs,
 * removals, and library changes update the Home selector and actions without
 * a restart. Outside the Tauri runtime (unit tests, plain web) it is a no-op;
 * the listener is cleaned up on unmount.
 */
export function useLocalLibraryWatcher({
  listen = tauriListen,
}: { listen?: EventListen } = {}): void {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!isTauriRuntime()) return;

    let cancelled = false;
    let unlisten: (() => void) | undefined;

    void listen<LocalLibrarySnapshot>(
      LOCAL_LIBRARY_CHANGED_EVENT,
      (event) => {
        if (cancelled) return;
        // The event is the freshest local truth: cancel any scan still in
        // flight so its older result cannot clobber the fresh snapshot.
        void queryClient.cancelQueries({ queryKey: LOCAL_LIBRARY_QUERY_KEY });
        queryClient.setQueryData(LOCAL_LIBRARY_QUERY_KEY, event.payload);
      },
    ).then((stop) => {
      if (cancelled) {
        void stop();
      } else {
        unlisten = stop;
      }
    });

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [listen, queryClient]);
}
