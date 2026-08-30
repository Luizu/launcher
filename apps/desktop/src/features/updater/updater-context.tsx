import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  updaterClient,
  type UpdateSnapshot,
} from "./updater-client";

export interface UpdaterClientLike {
  getSnapshot(): UpdateSnapshot;
  subscribe(listener: (snapshot: UpdateSnapshot) => void): () => void;
  check(): Promise<UpdateSnapshot>;
  install(): Promise<void>;
}

export interface UpdaterContextValue {
  snapshot: UpdateSnapshot;
  checkForUpdates: () => Promise<UpdateSnapshot>;
  installUpdate: () => Promise<void>;
}

export const UpdaterContext = createContext<UpdaterContextValue | null>(null);

const UPDATE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

/** Starts the safe background check for packaged desktop builds. */
export function UpdaterProvider({
  client = updaterClient,
  children,
}: {
  client?: UpdaterClientLike;
  children: ReactNode;
}) {
  const [snapshot, setSnapshot] = useState(() => client.getSnapshot());
  const autoCheckedClient = useRef<UpdaterClientLike | null>(null);

  useEffect(() => {
    const unsubscribe = client.subscribe(setSnapshot);
    if (autoCheckedClient.current !== client) {
      autoCheckedClient.current = client;
      void client.check().catch(() => undefined);
    }

    const intervalId =
      typeof window === "undefined"
        ? undefined
        : window.setInterval(() => {
            void client.check().catch(() => undefined);
          }, UPDATE_CHECK_INTERVAL_MS);

    return () => {
      unsubscribe();
      if (intervalId !== undefined) window.clearInterval(intervalId);
    };
  }, [client]);

  const checkForUpdates = useCallback(() => client.check(), [client]);
  const installUpdate = useCallback(() => client.install(), [client]);
  const value = useMemo(
    () => ({ snapshot, checkForUpdates, installUpdate }),
    [snapshot, checkForUpdates, installUpdate],
  );

  return <UpdaterContext.Provider value={value}>{children}</UpdaterContext.Provider>;
}

export function useUpdater(): UpdaterContextValue {
  const context = useContext(UpdaterContext);
  if (context === null) {
    throw new Error("useUpdater must be used within an UpdaterProvider");
  }
  return context;
}
