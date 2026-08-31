import type { ApiErrorResponse } from "@fuse-launcher/contracts";
import { defaultHttpFetcher } from "./http-fetcher";
import { DEFAULT_API_BASE_URL } from "./api-config";
import { reportRendererError } from "./observability/sentry";

export { DEFAULT_API_BASE_URL } from "./api-config";

/**
 * Typed error thrown by {@link ApiClient} for non-2xx API responses.
 *
 * Carries only the operational error surface: `status`, `code`, `message`,
 * and `nextAction`. Cookie values, response headers, and raw server bodies
 * are never exposed to application code.
 */
export class ApiClientError extends Error {
  readonly status: number;
  readonly code: string;
  readonly nextAction: string;

  constructor(status: number, code: string, message: string, nextAction: string) {
    super(message);
    this.name = "ApiClientError";
    this.status = status;
    this.code = code;
    this.nextAction = nextAction;
  }
}

export type Fetcher = typeof fetch;

const FALLBACK_CODE = "unknown-error";
const FALLBACK_NEXT_ACTION = "try again";

/**
 * Base URL used for local development when `VITE_API_URL` is not injected at
 * build time. Production builds must always inject `VITE_API_URL`; this constant
 * only serves `bun dev` / `bun dev:web` on a developer machine.
 */
/**
 * Typed HTTP client for the Fuse Launcher API. All HTTP lives here.
 *
 * Joins the base URL (from `VITE_API_URL`, injectable for tests) with the
 * relative path, sends JSON only when a body exists, includes credentials on
 * every request so Better Auth HTTP-only cookies persist in the Tauri
 * WebView, parses JSON responses (resolving `undefined` for 204, empty, or
 * non-JSON success bodies), and throws a typed {@link ApiClientError} for
 * non-2xx responses.
 */
export class ApiClient {
  private readonly baseUrl: string;
  private readonly fetcher: Fetcher;

  constructor(
    baseUrl: string | undefined = import.meta.env.VITE_API_URL ?? DEFAULT_API_BASE_URL,
    fetcher?: Fetcher,
  ) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.fetcher = fetcher ?? defaultHttpFetcher(this.baseUrl);
  }

  async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    if (!this.baseUrl) {
      throw new Error("ApiClient: VITE_API_URL is not configured");
    }

    const url = `${this.baseUrl}${path.startsWith("/") ? path : `/${path}`}`;
    const headers = new Headers(init.headers);
    const hasBody = init.body !== undefined && init.body !== null;
    if (hasBody) {
      headers.set("Content-Type", "application/json");
    }

    let response: Response;
    try {
      response = await this.fetcher(url, {
        ...init,
        headers,
        credentials: "include",
      });
    } catch (error) {
      reportRendererError(error, {
        event: "api_request_failed",
        method: init.method ?? "GET",
        path: safePath(url),
        status: 0,
      });
      throw error;
    }

    if (!response.ok) {
      throw await this.toError(response, url, init.method ?? "GET");
    }

    if (response.status === 204) {
      return undefined as T;
    }

    const text = await response.text();
    if (text.length === 0) {
      return undefined as T;
    }

    try {
      return JSON.parse(text) as T;
    } catch {
      // 2xx with a non-JSON body; treat the payload as absent instead of
      // throwing an untyped parse error.
      return undefined as T;
    }
  }

  private async toError(
    response: Response,
    url: string,
    method: string,
  ): Promise<ApiClientError> {
    let code = FALLBACK_CODE;
    let message = `request failed with status ${response.status}`;
    let nextAction = FALLBACK_NEXT_ACTION;

    try {
      const body = (await response.json()) as Partial<ApiErrorResponse>;
      if (typeof body.code === "string" && body.code.length > 0) {
        code = body.code;
      }
      if (typeof body.message === "string" && body.message.length > 0) {
        message = body.message;
      }
      if (typeof body.nextAction === "string" && body.nextAction.length > 0) {
        nextAction = body.nextAction;
      }
    } catch {
      // Non-JSON error body (gateway HTML, empty body); keep the fallbacks.
    }

    const error = new ApiClientError(response.status, code, message, nextAction);
    if (response.status >= 500) {
      reportRendererError(error, {
        event: "api_request_failed",
        method,
        path: safePath(url),
        status: response.status,
      });
    }

    return error;
  }
}

function safePath(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return "/unknown";
  }
}
