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

  it("uses the browser fetcher outside Tauri", () => {
    expect(defaultHttpFetcher()).toBe(globalThis.fetch);
  });

  it("uses the native HTTP fetcher for the scoped production API", () => {
    Object.defineProperty(window, "__TAURI_INTERNALS__", {
      configurable: true,
      value: {},
    });

    expect(defaultHttpFetcher(PRODUCTION_API_BASE_URL)).toBe(tauriFetch);
  });

  it("keeps unscoped remote URLs on browser fetch", () => {
    Object.defineProperty(window, "__TAURI_INTERNALS__", {
      configurable: true,
      value: {},
    });

    expect(defaultHttpFetcher("https://api.example.com")).toBe(
      globalThis.fetch,
    );
  });
});
