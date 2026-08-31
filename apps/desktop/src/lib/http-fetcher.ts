import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import {
  DEFAULT_API_BASE_URL,
  PRODUCTION_API_BASE_URL,
} from "./api-config";

const TAURI_HTTP_API_ORIGINS = new Set([
  new URL(DEFAULT_API_BASE_URL).origin,
  new URL(PRODUCTION_API_BASE_URL).origin,
]);

const browserFetch: typeof globalThis.fetch = (input, init) =>
  init === undefined
    ? globalThis.fetch(input)
    : globalThis.fetch(input, init);

/** Whether the frontend is running inside a Tauri WebView. */
export function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

/**
 * Selects the HTTP implementation for the current frontend runtime.
 *
 * Browser/Vite development keeps using the platform fetch so CORS remains
 * part of the web development flow. In a packaged Tauri app, the local and
 * production API origins use the HTTP plugin; its native cookie jar persists
 * Better Auth sessions and the capability scope explicitly permits both
 * origins. Other remote origins stay on browser fetch until they are added to
 * that allowlist deliberately.
 */
export function defaultHttpFetcher(
  baseUrl = DEFAULT_API_BASE_URL,
): typeof globalThis.fetch {
  if (!isTauriRuntime()) {
    return browserFetch;
  }

  try {
    if (TAURI_HTTP_API_ORIGINS.has(new URL(baseUrl).origin)) {
      return tauriFetch;
    }
  } catch {
    // Invalid or unscoped URLs must not cross the native capability boundary.
  }

  return browserFetch;
}
