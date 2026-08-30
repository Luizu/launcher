import { act, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { LaunchHistory } from "@launcher/contracts";
import { useLaunchHistory, launchHistoryToMap } from "./use-launch-history";
import type { LaunchHistoryClientLike } from "./launch-history-client";

const HISTORY_730 = {
  provider: "steam",
  externalGameId: 730,
  lastLaunchedAt: "2026-08-29T14:07:39Z",
} as const;

const HISTORY_4000 = {
  provider: "steam",
  externalGameId: 4000,
  lastLaunchedAt: "2026-08-28T10:00:00Z",
} as const;

function historyClient(
  getHistory: () => Promise<LaunchHistory>,
): LaunchHistoryClientLike {
  return { getHistory };
}

function HistoryProbe({ client }: { client: LaunchHistoryClientLike }) {
  const { entries } = useLaunchHistory({ client });
  return (
    <ul>
      {entries.map((entry) => (
        <li key={entry.externalGameId}>
          {entry.provider}:{entry.externalGameId}@{entry.lastLaunchedAt}
        </li>
      ))}
    </ul>
  );
}

describe("launchHistoryToMap", () => {
  it("joins each entry with the game key used by the Home ranking", () => {
    expect(
      launchHistoryToMap([HISTORY_730, HISTORY_4000]),
    ).toEqual({
      "steam:730": "2026-08-29T14:07:39Z",
      "steam:4000": "2026-08-28T10:00:00Z",
    });
  });

  it("keeps the last instant when an entry is recorded twice", () => {
    expect(
      launchHistoryToMap([
        HISTORY_730,
        { ...HISTORY_730, lastLaunchedAt: "2026-08-29T15:00:00Z" },
      ]),
    ).toEqual({ "steam:730": "2026-08-29T15:00:00Z" });
  });

  it("maps an empty history to an empty record", () => {
    expect(launchHistoryToMap([])).toEqual({});
  });
});

describe("useLaunchHistory", () => {
  it("loads the local history through the injected client", async () => {
    const getHistory = vi
      .fn()
      .mockResolvedValue({ entries: [HISTORY_730] });
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    render(
      <QueryClientProvider client={queryClient}>
        <HistoryProbe client={historyClient(getHistory)} />
      </QueryClientProvider>,
    );

    expect(
      await screen.findByText("steam:730@2026-08-29T14:07:39Z"),
    ).toBeDefined();
    expect(getHistory).toHaveBeenCalledTimes(1);
  });

  it("never sends the local history through the HTTP layer", async () => {
    const getHistory = vi
      .fn()
      .mockResolvedValue({ entries: [HISTORY_730] });
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("{}", { status: 200 }),
    );
    try {
      const queryClient = new QueryClient({
        defaultOptions: { queries: { retry: false } },
      });
      render(
        <QueryClientProvider client={queryClient}>
          <HistoryProbe client={historyClient(getHistory)} />
        </QueryClientProvider>,
      );

      expect(
        await screen.findByText("steam:730@2026-08-29T14:07:39Z"),
      ).toBeDefined();
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it("reports an empty history when the native command fails", async () => {
    const getHistory = vi.fn().mockRejectedValue(new Error("native down"));
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    render(
      <QueryClientProvider client={queryClient}>
        <HistoryProbe client={historyClient(getHistory)} />
      </QueryClientProvider>,
    );

    await act(async () => {});
    expect(screen.queryAllByRole("listitem")).toHaveLength(0);
  });
});
