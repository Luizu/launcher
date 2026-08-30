import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, useRoutes } from "react-router-dom";
import type {
  GameLibraryConnection,
  SessionResponse,
} from "@launcher/contracts";
import { AuthProvider } from "../features/auth/auth-context";
import { ApiClient } from "../lib/api-client";
import { AuthClient } from "../lib/auth-client";
import { routes } from "./router";

const apiState = vi.hoisted(() => ({
  fetchImpl: undefined as undefined | typeof fetch,
}));

// The route tree's clients are module-level singletons: `new ApiClient()`
// runs at import time, before any test stub exists. The fetcher wrapper
// therefore resolves the implementation per request, not per construction.
vi.mock("../lib/http-fetcher", () => ({
  defaultHttpFetcher: () =>
    ((input: RequestInfo | URL, init?: RequestInit) => {
      const impl = apiState.fetchImpl ?? globalThis.fetch;
      return impl(input, init);
    }) as typeof fetch,
  // Outside the Tauri runtime the watcher must be a no-op.
  isTauriRuntime: () => false,
}));

const session: SessionResponse = {
  user: {
    id: "user-1",
    email: "a@example.com",
    emailVerified: true,
    name: "A",
    image: null,
  },
  session: {
    id: "session-1",
    token: "token",
    userId: "user-1",
    expiresAt: "2026-09-01T00:00:00.000Z",
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
  },
};

const CONNECTION: GameLibraryConnection = {
  provider: "steam",
  visibility: "public",
  syncStatus: "synced",
  lastSyncedAt: null,
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/**
 * Plays the API the route tree talks to through the real clients: session
 * check, game-library state, and the Steam link endpoints.
 */
function stubApi(options: {
  session: SessionResponse | null;
  connection: GameLibraryConnection | null;
}) {
  apiState.fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.includes("/api/auth/get-session")) {
      return options.session
        ? jsonResponse(options.session)
        : jsonResponse({ message: "no session" }, 401);
    }
    if (url.includes("/api/game-library")) {
      return jsonResponse({ connection: options.connection, entries: [] });
    }
    if (url.includes("/api/game-pages/")) {
      return jsonResponse({
        identity: {
          id: "identity-1",
          name: "Counter-Strike 2",
          media: {},
        },
        entries: [
          {
            provider: "steam",
            externalGameId: "730",
            name: "Counter-Strike 2",
            enrichmentStatus: "enriched",
          },
        ],
      });
    }
    return jsonResponse({ message: "not found" }, 404);
  });
}

function RoutesProbe() {
  return useRoutes(routes);
}

function renderRoutes(initialEntries: string[]) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={initialEntries}>
        <AuthProvider client={new AuthClient(new ApiClient())}>
          <RoutesProbe />
        </AuthProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  apiState.fetchImpl = undefined;
});

describe("signed out", () => {
  it.each(["/", "/home", "/onboarding", "/library"])(
    "redirects %s to the auth screen",
    async (path) => {
      stubApi({ session: null, connection: null });
      renderRoutes([path]);

      expect(
        await screen.findByRole("heading", { name: "Entrar" }),
      ).toBeInTheDocument();
    },
  );
});

describe("signed in without a connection", () => {
  it("redirects the root to onboarding", async () => {
    stubApi({ session, connection: null });
    renderRoutes(["/"]);

    expect(
      await screen.findByRole("heading", { name: "Conecte sua conta Steam" }),
    ).toBeInTheDocument();
  });

  it("redirects /home to onboarding", async () => {
    stubApi({ session, connection: null });
    renderRoutes(["/home"]);

    expect(
      await screen.findByRole("heading", { name: "Conecte sua conta Steam" }),
    ).toBeInTheDocument();
  });

  it("keeps /library directly accessible without a connection", async () => {
    stubApi({ session, connection: null });
    renderRoutes(["/library"]);

    expect(
      await screen.findByRole("heading", { name: "Biblioteca" }),
    ).toBeInTheDocument();
  });
});

describe("signed in with a connection", () => {
  it("opens Home from the root", async () => {
    stubApi({ session, connection: CONNECTION });
    renderRoutes(["/"]);

    expect(
      await screen.findByRole("heading", { name: "Home" }),
    ).toBeInTheDocument();
  });

  it("opens Home from /home", async () => {
    stubApi({ session, connection: CONNECTION });
    renderRoutes(["/home"]);

    expect(
      await screen.findByRole("heading", { name: "Home" }),
    ).toBeInTheDocument();
  });

  it("redirects /onboarding back to Home once connected", async () => {
    stubApi({ session, connection: CONNECTION });
    renderRoutes(["/onboarding"]);

    expect(
      await screen.findByRole("heading", { name: "Home" }),
    ).toBeInTheDocument();
  });

  it("opens the game page at /games/:identityId", async () => {
    stubApi({ session, connection: CONNECTION });
    renderRoutes(["/games/identity-1"]);

    expect(
      await screen.findByRole("heading", { name: "Counter-Strike 2" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Provedores" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Voltar" })).toBeInTheDocument();
  });
});
