import { beforeEach, describe, expect, it, vi } from "vitest";

const { tauriFetch } = vi.hoisted(() => ({
  tauriFetch: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-http", () => ({
  fetch: tauriFetch,
}));

import { defaultHttpFetcher, isTauriRuntime } from "./http-fetcher";
import { PRODUCTION_API_BASE_URL } from "./api-config";

describe("desktop HTTP transport", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    delete (window as Window & { __TAURI_INTERNALS__?: unknown })
      .__TAURI_INTERNALS__;
    tauriFetch.mockReset();
  });

  it("detects the Tauri WebView runtime", () => {
    expect(isTauriRuntime()).toBe(false);

    Object.defineProperty(window, "__TAURI_INTERNALS__", {
      configurable: true,
      value: {},
    });

    expect(isTauriRuntime()).toBe(true);
  });

  it("uses the Tauri HTTP fetcher inside the desktop WebView", () => {
    Object.defineProperty(window, "__TAURI_INTERNALS__", {
      configurable: true,
      value: {},
    });

    expect(defaultHttpFetcher()).toBe(tauriFetch);
  });

  it("uses the browser fetcher outside Tauri", async () => {
    const browserFetch = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", browserFetch);

    await defaultHttpFetcher()("http://localhost:3000/api/health");

    expect(browserFetch).toHaveBeenCalledWith("http://localhost:3000/api/health");
  });

  it("keeps the browser fetch context outside Tauri", async () => {
    const browserFetch = vi.fn(function (this: unknown) {
      if (this !== globalThis) throw new TypeError("Illegal invocation");
      return Promise.resolve(new Response("{}", { status: 200 }));
    });
    vi.stubGlobal("fetch", browserFetch);

    await defaultHttpFetcher()("http://localhost:3000/api/health");

    expect(browserFetch).toHaveBeenCalledWith("http://localhost:3000/api/health");
  });

  it("uses the native HTTP fetcher for the scoped production API", () => {
    Object.defineProperty(window, "__TAURI_INTERNALS__", {
      configurable: true,
      value: {},
    });

    expect(defaultHttpFetcher(PRODUCTION_API_BASE_URL)).toBe(tauriFetch);
  });

  it("keeps unscoped remote URLs on browser fetch", async () => {
    Object.defineProperty(window, "__TAURI_INTERNALS__", {
      configurable: true,
      value: {},
    });
    const browserFetch = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", browserFetch);

    await defaultHttpFetcher("https://api.example.com")(
      "https://api.example.com/health",
    );

    expect(browserFetch).toHaveBeenCalledWith("https://api.example.com/health");
  });
});
