import { act, fireEvent, render } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { LocalLibrarySnapshot } from "@launcher/contracts";
import { useLocalLibrary, type UseLocalLibraryOptions } from "./use-local-library";

const EMPTY_SNAPSHOT: LocalLibrarySnapshot = { games: [], diagnostics: [] };

function scanClient(failing: boolean): { scan: () => Promise<LocalLibrarySnapshot> } {
  return {
    scan: failing
      ? vi.fn().mockRejectedValue(new Error("steam not installed"))
      : vi.fn().mockResolvedValue(EMPTY_SNAPSHOT),
  };
}

function Probe({ options }: { options: UseLocalLibraryOptions }) {
  const local = useLocalLibrary(options);
  return (
    <div>
      <p>error: {String(local.isError)}</p>
      <p>count: {local.snapshot?.games.length ?? 0}</p>
    </div>
  );
}

function renderProbe(options: UseLocalLibraryOptions) {
  const queryClient = new QueryClient();
  const view = render(
    <QueryClientProvider client={queryClient}>
      <Probe options={options} />
    </QueryClientProvider>,
  );
  return { queryClient, ...view };
}

describe("useLocalLibrary scan query", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("does not refetch an errored scan on window focus", async () => {
    vi.useFakeTimers();
    const client = scanClient(true);
    renderProbe({ client });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000); // let every retry settle
    });
    expect(client.scan).toHaveBeenCalledTimes(2); // initial + one retry

    fireEvent(window, new Event("focus"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(client.scan).toHaveBeenCalledTimes(2); // focus must not refetch
  });

  it("retries a failing scan at most once on mount", async () => {
    vi.useFakeTimers();
    const client = scanClient(true);
    renderProbe({ client });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(client.scan).toHaveBeenCalledTimes(2); // initial + one retry
  });

  it("keeps the successful snapshot without extra scans", async () => {
    vi.useFakeTimers();
    const client = scanClient(false);
    renderProbe({ client });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(client.scan).toHaveBeenCalledTimes(1);
  });
});
