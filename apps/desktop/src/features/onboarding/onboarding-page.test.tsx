import { act, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type {
  GameLibraryConnection,
  GameLibraryResponse,
  LinkAttemptStatus,
} from "@launcher/contracts";
import type { GameLibraryClientLike } from "../game-library/game-library-client";
import type { PlatformConnectionsClientLike } from "../platform-connections/platform-connections-client";
import { OnboardingPage } from "./onboarding-page";

const AUTHORIZATION_URL = "https://steamcommunity.com/openid/login";

const CONNECTION_SYNCED: GameLibraryConnection = {
  provider: "steam",
  visibility: "public",
  syncStatus: "synced",
  lastSyncedAt: "2026-08-28T12:00:00",
};

function terminalStatus(
  attemptId: string,
  status: "failed" | "expired",
): LinkAttemptStatus {
  return {
    attemptId,
    provider: "steam",
    status,
    expiresAt: "2026-08-28T00:02:00.000Z",
    completedAt: null,
  };
}

function gameLibraryClient(
  list: () => Promise<GameLibraryResponse>,
): GameLibraryClientLike {
  return { list, sync: vi.fn() };
}

interface RenderOnboardingOptions {
  list?: () => Promise<GameLibraryResponse>;
  getLinkStatus?: (attemptId: string) => Promise<LinkAttemptStatus>;
}

function renderOnboarding({ list, getLinkStatus }: RenderOnboardingOptions = {}) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const platformConnections: PlatformConnectionsClientLike = {
    startSteamLink: vi.fn().mockResolvedValue({
      attemptId: "attempt-1",
      authorizationUrl: AUTHORIZATION_URL,
    }),
    getSteamLinkStatus:
      getLinkStatus ?? vi.fn().mockResolvedValue(terminalStatus("attempt-1", "failed")),
  };
  const openUrl = vi.fn().mockResolvedValue(undefined);
  render(
    <QueryClientProvider client={queryClient}>
      <OnboardingPage
        openUrl={openUrl}
        platformConnections={platformConnections}
        gameLibrary={gameLibraryClient(
          list ?? vi.fn().mockResolvedValue({ connection: null, entries: [] }),
        )}
      />
    </QueryClientProvider>,
  );
  return { platformConnections, openUrl };
}

it("explains why the connection is needed and offers the Steam flow", async () => {
  renderOnboarding();

  expect(
    screen.getByRole("heading", { name: "Conecte sua conta Steam" }),
  ).toBeInTheDocument();
  expect(
    screen.getByText(/sincronizar sua biblioteca remota/i),
  ).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Conectar Steam" })).toBeInTheDocument();
  // The launcher never asks for Steam credentials.
  expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
});

it("keeps a failed link attempt actionable inside onboarding", async () => {
  vi.useFakeTimers();
  try {
    renderOnboarding({
      getLinkStatus: vi
        .fn()
        .mockResolvedValue(terminalStatus("attempt-1", "failed")),
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Conectar Steam" }));
    });
    expect(screen.getByText("Aguardando confirmação da Steam")).toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });

    expect(
      screen.getByText("Não foi possível confirmar a conexão com a Steam."),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Tentar novamente" }),
    ).toBeInTheDocument();
  } finally {
    vi.useRealTimers();
  }
});

it("keeps an expired link attempt actionable inside onboarding", async () => {
  vi.useFakeTimers();
  try {
    renderOnboarding({
      getLinkStatus: vi
        .fn()
        .mockResolvedValue(terminalStatus("attempt-1", "expired")),
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Conectar Steam" }));
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });

    expect(
      screen.getByText("Não foi possível confirmar a conexão com a Steam."),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Tentar novamente" }),
    ).toBeInTheDocument();
  } finally {
    vi.useRealTimers();
  }
});

it("reaches the connected state when a link attempt completes", async () => {
  vi.useFakeTimers();
  try {
    const list = vi
      .fn()
      .mockResolvedValueOnce({ connection: null, entries: [] })
      .mockResolvedValue({ connection: CONNECTION_SYNCED, entries: [] });
    renderOnboarding({
      list,
      getLinkStatus: vi.fn().mockResolvedValue({
        attemptId: "attempt-1",
        provider: "steam",
        status: "completed",
        expiresAt: "2026-08-28T00:02:00.000Z",
        completedAt: "2026-08-28T00:00:00.000Z",
      }),
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Conectar Steam" }));
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
      // Flush the invalidation-triggered library refetch (react-query
      // schedules its notifications through the timer queue).
      await vi.advanceTimersByTimeAsync(50);
      await vi.advanceTimersByTimeAsync(50);
    });

    // The completed poll triggers the library refetch; once the connection
    // lands, the card reports the connected state.
    expect(screen.getByText("Sincronizada")).toBeInTheDocument();
    expect(list).toHaveBeenCalledTimes(2);
  } finally {
    vi.useRealTimers();
  }
});
