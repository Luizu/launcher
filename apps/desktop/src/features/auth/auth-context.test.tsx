import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, useRoutes } from "react-router-dom";
import type { SessionResponse } from "@fuse-launcher/contracts";
import { AuthProvider, toHumanReadableAuthError, type AuthClientLike } from "./auth-context";
import { useSession } from "./use-session";
import { routes } from "../../app/router";
import { ApiClientError } from "../../lib/api-client";

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

function SessionProbe() {
  const {
    session: current,
    isLoading,
    sessionError,
    retry,
    signIn,
    signUp,
    signOut,
    isSigningOut,
  } = useSession();
  return (
    <div>
      <p data-testid="state">{isLoading ? "loading" : "loaded"}</p>
      <p data-testid="session">{current?.user.email ?? "none"}</p>
      <p data-testid="signing-out">{isSigningOut ? "pending" : "idle"}</p>
      {sessionError && <p role="alert">{sessionError}</p>}
      <button onClick={() => retry()}>Tentar novamente</button>
      <button
        onClick={() => {
          void signIn({ email: "a@example.com", password: "secret" });
        }}
      >
        Entrar
      </button>
      <button
        onClick={() => {
          void signUp({ email: "a@example.com", password: "secret" });
        }}
      >
        Criar conta
      </button>
      <button
        onClick={() => {
          void signOut();
        }}
      >
        Sair
      </button>
    </div>
  );
}

function renderSessionProbe(
  client: AuthClientLike,
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } }),
) {
  return render(
    <QueryClientProvider client={queryClient}>
      <AuthProvider client={client}>
        <SessionProbe />
      </AuthProvider>
    </QueryClientProvider>,
  );
}

function AuthRoutes({ client }: { client: AuthClientLike }) {
  const element = useRoutes(routes);
  return <AuthProvider client={client}>{element}</AuthProvider>;
}

function renderRoutes(client: AuthClientLike, initialEntries: string[]) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={initialEntries}>
        <AuthRoutes client={client} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("session state", () => {
  it("loads the session on mount", async () => {
    const client: AuthClientLike = {
      getSession: vi.fn().mockResolvedValue(session),
      signIn: vi.fn(),
      signUp: vi.fn(),
      signOut: vi.fn(),
    };
    renderSessionProbe(client);

    expect(await screen.findByText("a@example.com")).toBeInTheDocument();
    expect(screen.getByTestId("state")).toHaveTextContent("loaded");
    expect(client.getSession).toHaveBeenCalledTimes(1);
  });

  it("treats a 401 session check as the signed-out state", async () => {
    const client: AuthClientLike = {
      getSession: vi
        .fn()
        .mockRejectedValue(new ApiClientError(401, "unauthorized", "no session", "sign in")),
      signIn: vi.fn(),
      signUp: vi.fn(),
      signOut: vi.fn(),
    };
    renderSessionProbe(client);

    await waitFor(() => expect(screen.getByTestId("session")).toHaveTextContent("none"));
    expect(screen.getByTestId("state")).toHaveTextContent("loaded");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("shows a retryable error when the session check fails, then retries", async () => {
    const getSession = vi
      .fn()
      .mockRejectedValueOnce(new Error("network down"))
      .mockResolvedValueOnce(null);
    const client: AuthClientLike = {
      getSession,
      signIn: vi.fn(),
      signUp: vi.fn(),
      signOut: vi.fn(),
    };
    const user = userEvent.setup();
    renderSessionProbe(client);

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Não foi possível verificar sua sessão.");

    await user.click(screen.getByRole("button", { name: "Tentar novamente" }));

    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
    expect(getSession).toHaveBeenCalledTimes(2);
  });

  it("stores the session returned by sign-in", async () => {
    const client: AuthClientLike = {
      getSession: vi.fn().mockResolvedValue(null),
      signIn: vi.fn().mockResolvedValue(session),
      signUp: vi.fn(),
      signOut: vi.fn(),
    };
    const user = userEvent.setup();
    renderSessionProbe(client);

    await waitFor(() => expect(screen.getByTestId("state")).toHaveTextContent("loaded"));
    await user.click(screen.getByRole("button", { name: "Entrar" }));

    await waitFor(() =>
      expect(screen.getByTestId("session")).toHaveTextContent("a@example.com"),
    );
  });

  it("stores the session returned by sign-up and clears the query cache", async () => {
    const client: AuthClientLike = {
      getSession: vi.fn().mockResolvedValue(null),
      signIn: vi.fn(),
      signUp: vi.fn().mockResolvedValue(session),
      signOut: vi.fn(),
    };
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    queryClient.setQueryData(["seeded"], "stale data");
    const user = userEvent.setup();
    renderSessionProbe(client, queryClient);

    await waitFor(() => expect(screen.getByTestId("state")).toHaveTextContent("loaded"));
    await user.click(screen.getByRole("button", { name: "Criar conta" }));

    await waitFor(() =>
      expect(screen.getByTestId("session")).toHaveTextContent("a@example.com"),
    );
    expect(queryClient.getQueryData(["seeded"])).toBeUndefined();
  });

  it("clears the session on sign-out", async () => {
    const client: AuthClientLike = {
      getSession: vi.fn().mockResolvedValue(session),
      signIn: vi.fn(),
      signUp: vi.fn(),
      signOut: vi.fn().mockResolvedValue(undefined),
    };
    const user = userEvent.setup();
    renderSessionProbe(client);

    await screen.findByText("a@example.com");
    await user.click(screen.getByRole("button", { name: "Sair" }));

    await waitFor(() => expect(screen.getByTestId("session")).toHaveTextContent("none"));
  });

  it("exposes a pending state while sign-out is in flight", async () => {
    let resolveSignOut!: () => void;
    const signOut = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveSignOut = resolve;
        }),
    );
    const client: AuthClientLike = {
      getSession: vi.fn().mockResolvedValue(session),
      signIn: vi.fn(),
      signUp: vi.fn(),
      signOut,
    };
    const user = userEvent.setup();
    renderSessionProbe(client);

    await screen.findByText("a@example.com");
    await user.click(screen.getByRole("button", { name: "Sair" }));

    expect(screen.getByTestId("signing-out")).toHaveTextContent("pending");
    expect(signOut).toHaveBeenCalledOnce();

    resolveSignOut();
    await waitFor(() => expect(screen.getByTestId("session")).toHaveTextContent("none"));
    expect(screen.getByTestId("signing-out")).toHaveTextContent("idle");
  });
});

describe("toHumanReadableAuthError", () => {
  it("maps HTTP statuses by shape, not class identity", () => {
    expect(
      toHumanReadableAuthError(new ApiClientError(409, "user-already-exists", "x", "y")),
    ).toBe("Já existe uma conta com este e-mail.");
    expect(toHumanReadableAuthError({ status: 401 })).toBe("E-mail ou senha incorretos.");
    expect(toHumanReadableAuthError(new Error("network down"))).toBe(
      "Não foi possível conectar ao servidor. Verifique sua conexão e tente novamente.",
    );
  });
});

describe("route guard", () => {
  it("redirects signed-out users from the library to the auth page", async () => {
    const client: AuthClientLike = {
      getSession: vi.fn().mockResolvedValue(null),
      signIn: vi.fn(),
      signUp: vi.fn(),
      signOut: vi.fn(),
    };
    renderRoutes(client, ["/library"]);

    expect(await screen.findByRole("heading", { name: "Entrar" })).toBeInTheDocument();
  });

  it("redirects signed-in users from the auth page to the library", async () => {
    const client: AuthClientLike = {
      getSession: vi.fn().mockResolvedValue(session),
      signIn: vi.fn(),
      signUp: vi.fn(),
      signOut: vi.fn(),
    };
    renderRoutes(client, ["/auth"]);

    expect(await screen.findByRole("heading", { name: "Biblioteca" })).toBeInTheDocument();
  });
});
