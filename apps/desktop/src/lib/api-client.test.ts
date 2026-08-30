import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiClient, DEFAULT_API_BASE_URL, type Fetcher } from "./api-client";
import { AuthClient } from "./auth-client";
import * as rendererObservability from "./observability/sentry";

vi.mock("./observability/sentry", () => ({
  reportRendererError: vi.fn(),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe("ApiClient", () => {
  it("falls back to the local API when VITE_API_URL is not configured", async () => {
    vi.stubEnv("VITE_API_URL", undefined);
    const fetcher = vi.fn().mockResolvedValue(
      new Response("{}", { status: 200 }),
    );
    const client = new ApiClient(undefined, fetcher);

    await client.request("/api/health");

    expect(fetcher).toHaveBeenCalledWith(
      `${DEFAULT_API_BASE_URL}/api/health`,
      expect.anything(),
    );
  });

  it("prefers an injected VITE_API_URL over the fallback", async () => {
    vi.stubEnv("VITE_API_URL", "http://api.example.test");
    const fetcher = vi.fn().mockResolvedValue(
      new Response("{}", { status: 200 }),
    );
    const client = new ApiClient(undefined, fetcher);

    await client.request("/api/health");

    expect(fetcher).toHaveBeenCalledWith(
      "http://api.example.test/api/health",
      expect.anything(),
    );
  });


  it("sends Better Auth cookies with API requests", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ status: "ok" }), { status: 200 }),
    );
    const client = new ApiClient("http://localhost:3000", fetcher);

    await client.request("/api/health");

    expect(fetcher).toHaveBeenCalledWith(
      "http://localhost:3000/api/health",
      expect.objectContaining({ credentials: "include" }),
    );
  });

  it("joins the base URL and the relative path", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response("{}", { status: 200 }),
    );
    const client = new ApiClient("http://localhost:3000", fetcher);

    await client.request("api/game-library");

    expect(fetcher).toHaveBeenCalledWith(
      "http://localhost:3000/api/game-library",
      expect.anything(),
    );
  });

  it("parses JSON responses into the requested type", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ status: "ok" }), { status: 200 }),
    );
    const client = new ApiClient("http://localhost:3000", fetcher);

    await expect(client.request<{ status: string }>("/api/health")).resolves.toEqual({
      status: "ok",
    });
  });

  it("resolves to undefined for a 204 No Content response", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(null, { status: 204 }),
    );
    const client = new ApiClient("http://localhost:3000", fetcher);

    await expect(client.request("/api/game-library")).resolves.toBeUndefined();
  });

  it("resolves to undefined for a 2xx response with an empty body", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response("", { status: 200 }),
    );
    const client = new ApiClient("http://localhost:3000", fetcher);

    await expect(client.request("/api/game-library")).resolves.toBeUndefined();
  });

  it("resolves to undefined for a 2xx response with a non-JSON body", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response("OK", { status: 200 }),
    );
    const client = new ApiClient("http://localhost:3000", fetcher);

    await expect(client.request("/api/game-library")).resolves.toBeUndefined();
  });

  it("sends a JSON body only when a body exists", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ status: "ok" }), { status: 200 }),
    );
    const client = new ApiClient("http://localhost:3000", fetcher);

    await client.request("/api/auth/sign-out", { method: "POST" });

    const [, init] = fetcher.mock.calls[0];
    expect(init.headers.get("content-type")).toBeNull();
  });

  it("throws a typed ApiClientError with status, code, message, and nextAction for non-2xx responses", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          status: "error",
          code: "unauthorized",
          message: "session expired",
          nextAction: "sign in again",
        }),
        { status: 401 },
      ),
    );
    const client = new ApiClient("http://localhost:3000", fetcher);

    const error = await client
      .request("/api/game-library")
      .catch((caught: unknown) => caught);

    expect(error).toMatchObject({
      name: "ApiClientError",
      status: 401,
      code: "unauthorized",
      message: "session expired",
      nextAction: "sign in again",
    });
    expect(Object.keys(error as object).sort()).toEqual([
      "code",
      "name",
      "nextAction",
      "status",
    ]);
  });

  it("keeps a stable error shape when the error body is not JSON", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response("<html>gateway error</html>", { status: 503 }),
    );
    const client = new ApiClient("http://localhost:3000", fetcher);

    const error = await client
      .request("/api/game-library/sync")
      .catch((caught: unknown) => caught);

    expect(error).toMatchObject({
      name: "ApiClientError",
      status: 503,
      code: "unknown-error",
      message: "request failed with status 503",
      nextAction: "try again",
    });
  });

  it("reports unexpected API 5xx failures with only safe HTTP context", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response("gateway body with secret=private-value", { status: 503 }),
    );
    const client = new ApiClient("http://localhost:3000", fetcher);

    await expect(client.request("/api/game-library?token=private-value")).rejects.toMatchObject({
      status: 503,
    });

    expect(rendererObservability.reportRendererError).toHaveBeenCalledWith(
      expect.objectContaining({ name: "ApiClientError", status: 503 }),
      {
        event: "api_request_failed",
        method: "GET",
        path: "/api/game-library",
        status: 503,
      },
    );
  });

  it("reports unexpected transport failures with only safe HTTP context", async () => {
    const transportError = new Error("fetch failed for token=private-value");
    const fetcher = vi.fn().mockRejectedValue(transportError);
    const client = new ApiClient("http://localhost:3000", fetcher);

    await expect(
      client.request("/api/game-library?token=private-value"),
    ).rejects.toBe(transportError);

    expect(rendererObservability.reportRendererError).toHaveBeenCalledWith(
      transportError,
      {
        event: "api_request_failed",
        method: "GET",
        path: "/api/game-library",
        status: 0,
      },
    );
  });
});

describe("AuthClient", () => {
  function makeAuth(fetcher: Fetcher) {
    return new AuthClient(new ApiClient("http://localhost:3000", fetcher));
  }

  it("signs up through the Better Auth email endpoint", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          user: { id: "u1", email: "new@example.com", emailVerified: false, name: null, image: null },
          session: { id: "s1", token: "t1", userId: "u1", expiresAt: "2026-09-01T00:00:00Z", createdAt: "2026-08-28T00:00:00Z", updatedAt: "2026-08-28T00:00:00Z" },
        }),
        { status: 200 },
      ),
    );
    const auth = makeAuth(fetcher);

    await auth.signUp({ email: "new@example.com", password: "a-secure-password-123" });

    expect(fetcher).toHaveBeenCalledWith(
      "http://localhost:3000/api/auth/sign-up/email",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ email: "new@example.com", password: "a-secure-password-123" }),
        credentials: "include",
      }),
    );
  });

  it("signs in through the Better Auth email endpoint", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          user: { id: "u1", email: "user@example.com", emailVerified: true, name: "User", image: null },
          session: { id: "s1", token: "t1", userId: "u1", expiresAt: "2026-09-01T00:00:00Z", createdAt: "2026-08-28T00:00:00Z", updatedAt: "2026-08-28T00:00:00Z" },
        }),
        { status: 200 },
      ),
    );
    const auth = makeAuth(fetcher);

    await auth.signIn({ email: "user@example.com", password: "a-secure-password-123" });

    expect(fetcher).toHaveBeenCalledWith(
      "http://localhost:3000/api/auth/sign-in/email",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ email: "user@example.com", password: "a-secure-password-123" }),
      }),
    );
  });

  it("signs out through the Better Auth endpoint", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ success: true }), { status: 200 }),
    );
    const auth = makeAuth(fetcher);

    await auth.signOut();

    expect(fetcher).toHaveBeenCalledWith(
      "http://localhost:3000/api/auth/sign-out",
      expect.objectContaining({ method: "POST", credentials: "include" }),
    );
  });

  it("returns the session from get-session or null when signed out", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          user: { id: "u1", email: "user@example.com", emailVerified: true, name: "User", image: null },
          session: { id: "s1", token: "t1", userId: "u1", expiresAt: "2026-09-01T00:00:00Z", createdAt: "2026-08-28T00:00:00Z", updatedAt: "2026-08-28T00:00:00Z" },
        }),
        { status: 200 },
      ),
    );
    const auth = makeAuth(fetcher);

    const session = await auth.getSession();

    expect(fetcher).toHaveBeenCalledWith(
      "http://localhost:3000/api/auth/get-session",
      expect.anything(),
    );
    expect(session).toMatchObject({ user: { email: "user@example.com" } });
  });

  it("resolves to null when get-session returns a null body", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response("null", { status: 200 }),
    );
    const auth = makeAuth(fetcher);

    await expect(auth.getSession()).resolves.toBeNull();
  });
});
