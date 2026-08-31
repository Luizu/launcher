import * as Sentry from "@sentry/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  initializeRendererSentry,
  reportRendererError,
  registerRendererErrorHandlers,
} from "./sentry";

vi.mock("@sentry/react", () => ({
  captureException: vi.fn(),
  init: vi.fn(),
  withScope: vi.fn((callback: (scope: unknown) => void) =>
    callback({
      setExtras: vi.fn(),
      setTag: vi.fn(),
    }),
  ),
}));

describe("renderer Sentry", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    initializeRendererSentry({ dsn: undefined, isProduction: false, version: "0.3.0" });
  });

  it("does not initialize transport without a DSN", () => {
    expect(initializeRendererSentry({ dsn: "", isProduction: false, version: "0.3.0" })).toBe(false);
    expect(Sentry.init).not.toHaveBeenCalled();
  });

  it("initializes with a release and sanitizes sensitive request data", () => {
    expect(
      initializeRendererSentry({
        dsn: "https://public@example.ingest.sentry.io/1",
        isProduction: true,
        version: "0.3.0",
      }),
    ).toBe(true);

    expect(Sentry.init).toHaveBeenCalledWith(
      expect.objectContaining({
        dsn: "https://public@example.ingest.sentry.io/1",
        environment: "production",
        release: "fuse-launcher@0.3.0",
        sendDefaultPii: false,
      }),
    );

    const options = vi.mocked(Sentry.init).mock.calls[0]?.[0];
    const beforeSend = options?.beforeSend;
    expect(beforeSend).toBeDefined();

    const event = beforeSend?.(
      {
        message: "request failed",
        request: {
          url: "https://api.example.com/api/library?token=private-value",
          headers: { authorization: "Bearer private-value" },
          data: { password: "private-value" },
        },
        extra: { password: "private-value" },
      } as never,
      {},
    );

    expect(JSON.stringify(event)).not.toContain("private-value");
    expect(event).toMatchObject({ request: { method: undefined, url: "/api/library" } });
  });

  it("does not report expected auth errors or cancellations", () => {
    initializeRendererSentry({ dsn: "https://public@example.ingest.sentry.io/1", isProduction: false });
    const beforeSend = vi.mocked(Sentry.init).mock.calls[0]?.[0].beforeSend;

    expect(
      beforeSend?.({} as never, { originalException: { status: 401 } }),
    ).toBeNull();
    expect(
      beforeSend?.({} as never, { originalException: { name: "AbortError" } }),
    ).toBeNull();
  });

  it("reports an unexpected renderer error with safe context", () => {
    initializeRendererSentry({ dsn: "https://public@example.ingest.sentry.io/1", isProduction: false });
    const error = new Error("unexpected failure");

    reportRendererError(error, {
      event: "renderer_error",
      route: "/home",
      token: "private-value",
    });

    expect(Sentry.captureException).toHaveBeenCalledWith(error);
    const scope = vi.mocked(Sentry.withScope).mock.calls[0]?.[0];
    expect(scope).toBeDefined();
  });

  it("reports uncaught errors and unhandled rejections", () => {
    initializeRendererSentry({ dsn: "https://public@example.ingest.sentry.io/1", isProduction: false });
    const cleanup = registerRendererErrorHandlers();
    const errorEvent = new Event("error");
    Object.defineProperty(errorEvent, "error", { value: new Error("uncaught") });
    const rejectionEvent = new Event("unhandledrejection");
    Object.defineProperty(rejectionEvent, "reason", { value: new Error("rejected") });

    window.dispatchEvent(errorEvent);
    window.dispatchEvent(rejectionEvent);
    cleanup();

    expect(Sentry.captureException).toHaveBeenCalledTimes(2);
  });
});
