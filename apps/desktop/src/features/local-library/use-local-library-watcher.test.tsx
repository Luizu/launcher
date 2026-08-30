import { act, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { LocalLibrarySnapshot } from "@launcher/contracts";
import { useLocalLibrary } from "./use-local-library";
import {
  LOCAL_LIBRARY_CHANGED_EVENT,
  useLocalLibraryWatcher,
  type EventListen,
} from "./use-local-library-watcher";

const EMPTY_SNAPSHOT: LocalLibrarySnapshot = { games: [], diagnostics: [] };

const CS2_SNAPSHOT: LocalLibrarySnapshot = {
  games: [
    {
      provider: "steam",
      externalGameId: 730,
      name: "Counter-Strike 2",
      state: "installed",
    },
  ],
  diagnostics: [],
};

function scanClient(): { scan: () => Promise<LocalLibrarySnapshot> } {
  return { scan: vi.fn().mockResolvedValue(EMPTY_SNAPSHOT) };
}

function Probe({
  listen,
}: {
  listen?: EventListen;
}) {
  const local = useLocalLibrary({ client: scanClient() });
  useLocalLibraryWatcher({ listen });
  return (
    <div>
      {local.snapshot?.games.map((game) => (
        <p key={game.externalGameId}>{game.name}</p>
      ))}
      <p>count: {local.snapshot?.games.length ?? 0}</p>
    </div>
  );
}

describe("useLocalLibraryWatcher", () => {
  afterEach(() => {
    delete (window as unknown as { __TAURI_INTERNALS__?: unknown })
      .__TAURI_INTERNALS__;
  });

  it("updates the local library cache when the watcher event arrives", async () => {
    (window as unknown as { __TAURI_INTERNALS__: unknown }).__TAURI_INTERNALS__ = {};
    let handler: ((event: { payload: LocalLibrarySnapshot }) => void) | undefined;
    const listen = vi.fn((_event: string, onEvent: (event: { payload: LocalLibrarySnapshot }) => void) => {
      handler = onEvent;
      return Promise.resolve(vi.fn());
    }) as unknown as EventListen;
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    render(
      <QueryClientProvider client={queryClient}>
        <Probe listen={listen} />
      </QueryClientProvider>,
    );

    expect(listen).toHaveBeenCalledWith(
      LOCAL_LIBRARY_CHANGED_EVENT,
      expect.any(Function),
    );
    expect(handler).toBeDefined();

    // The async act fires the event and lets the initial scan's late
    // resolution settle; the fresh snapshot must survive both. The query
    // notification lands on a timer, so the UI needs a waitFor flush.
    await act(async () => {
      handler!({ payload: CS2_SNAPSHOT });
    });

    expect(await screen.findByText("Counter-Strike 2")).toBeInTheDocument();
    expect(screen.getByText("count: 1")).toBeInTheDocument();
    expect(
      queryClient.getQueryData<LocalLibrarySnapshot>(["local-library"]),
    ).toEqual(CS2_SNAPSHOT);
  });

  it("does not subscribe outside the Tauri runtime", () => {
    const listen = vi.fn();
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    render(
      <QueryClientProvider client={queryClient}>
        <Probe listen={listen as unknown as EventListen} />
      </QueryClientProvider>,
    );

    expect(listen).not.toHaveBeenCalled();
    // The probe still works on its own: the scan resolves the empty snapshot.
    expect(screen.getByText("count: 0")).toBeInTheDocument();
  });

  it("unsubscribes when the component unmounts", async () => {
    (window as unknown as { __TAURI_INTERNALS__: unknown }).__TAURI_INTERNALS__ = {};
    const unlisten = vi.fn();
    const listen = vi.fn(() => Promise.resolve(unlisten));
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    const view = render(
      <QueryClientProvider client={queryClient}>
        <Probe listen={listen as unknown as EventListen} />
      </QueryClientProvider>,
    );

    // Let the subscription promise settle before unmounting.
    await act(async () => {});
    view.unmount();

    expect(unlisten).toHaveBeenCalledTimes(1);
  });
});
