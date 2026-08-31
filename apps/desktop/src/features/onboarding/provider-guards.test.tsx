import { act, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type {
  GameLibraryConnection,
  GameLibraryResponse,
} from "@fuse-launcher/contracts";
import type { GameLibraryClientLike } from "../game-library/game-library-client";
import { GAME_LIBRARY_QUERY_KEY } from "../platform-connections/use-steam-connection";
import {
  RequireNoProviderConnection,
  RequireProviderConnection,
} from "./provider-guards";

const CONNECTION: GameLibraryConnection = {
  provider: "steam",
  visibility: "public",
  syncStatus: "synced",
  lastSyncedAt: null,
};

function gameLibraryClient(
  list: () => Promise<GameLibraryResponse>,
): GameLibraryClientLike {
  return { list, sync: vi.fn() };
}

function renderGuards(list: () => Promise<GameLibraryResponse>, initialEntries: string[]) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const client = gameLibraryClient(list);
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={initialEntries}>
        <Routes>
          <Route
            path="/home"
            element={
              <RequireProviderConnection gameLibrary={client}>
                <p>conteudo-home</p>
              </RequireProviderConnection>
            }
          />
          <Route
            path="/onboarding"
            element={
              <RequireNoProviderConnection gameLibrary={client}>
                <p>conteudo-onboarding</p>
              </RequireNoProviderConnection>
            }
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

it("redirects a user without a connection away from Home to onboarding", async () => {
  renderGuards(
    vi.fn().mockResolvedValue({ connection: null, entries: [] }),
    ["/home"],
  );

  expect(await screen.findByText("conteudo-onboarding")).toBeInTheDocument();
});

it("lets a user with a connection reach Home", async () => {
  renderGuards(
    vi.fn().mockResolvedValue({ connection: CONNECTION, entries: [] }),
    ["/home"],
  );

  expect(await screen.findByText("conteudo-home")).toBeInTheDocument();
});

it("redirects onboarding back to Home when a connection exists", async () => {
  renderGuards(
    vi.fn().mockResolvedValue({ connection: CONNECTION, entries: [] }),
    ["/onboarding"],
  );

  expect(await screen.findByText("conteudo-home")).toBeInTheDocument();
});

it("keeps onboarding visible while no connection exists", async () => {
  renderGuards(
    vi.fn().mockResolvedValue({ connection: null, entries: [] }),
    ["/onboarding"],
  );

  expect(await screen.findByText("conteudo-onboarding")).toBeInTheDocument();
});

it("shows a loading state while the connection status is unknown", () => {
  renderGuards(
    vi.fn().mockReturnValue(new Promise<GameLibraryResponse>(() => {})),
    ["/home"],
  );

  expect(
    screen.getByRole("status", { name: /verificando conex/i }),
  ).toBeInTheDocument();
});

it("redirects to Home once a connection appears during onboarding", async () => {
  const list = vi
    .fn()
    .mockResolvedValueOnce({ connection: null, entries: [] })
    .mockResolvedValue({ connection: CONNECTION, entries: [] });
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const client = gameLibraryClient(list);

  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/onboarding"]}>
        <Routes>
          <Route
            path="/home"
            element={
              <RequireProviderConnection gameLibrary={client}>
                <p>conteudo-home</p>
              </RequireProviderConnection>
            }
          />
          <Route
            path="/onboarding"
            element={
              <RequireNoProviderConnection gameLibrary={client}>
                <p>conteudo-onboarding</p>
              </RequireNoProviderConnection>
            }
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );

  expect(await screen.findByText("conteudo-onboarding")).toBeInTheDocument();
  expect(list).toHaveBeenCalledTimes(1);

  // Mirrors the card's `onConnected` invalidation after a completed link.
  await act(async () => {
    await queryClient.invalidateQueries({ queryKey: GAME_LIBRARY_QUERY_KEY });
  });

  expect(await screen.findByText("conteudo-home")).toBeInTheDocument();
  // Initial load + invalidation refetch + the Home guard's mount refetch
  // (the cached connection is immediately stale with `staleTime: 0`).
  expect(list).toHaveBeenCalledTimes(3);
});
