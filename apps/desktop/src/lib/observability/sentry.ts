import * as Sentry from "@sentry/react";
import { sanitizeText, sanitizeValue } from "./sanitize";
import { appLogger } from "./logger";

export interface RendererSentryOptions {
  dsn?: string;
  isProduction?: boolean;
  version?: string;
}

let rendererSentryEnabled = false;

export function initializeRendererSentry(
  options: RendererSentryOptions = {},
): boolean {
  const dsn = options.dsn ?? import.meta.env.VITE_SENTRY_DSN;
  if (!dsn?.trim()) {
    rendererSentryEnabled = false;
    return false;
  }

  if (rendererSentryEnabled) {
    return true;
  }

  const isProduction = options.isProduction ?? import.meta.env.PROD;
  const version = options.version ?? import.meta.env.VITE_APP_VERSION ?? "unknown";

  Sentry.init({
    dsn,
    environment: isProduction ? "production" : "development",
    release: `launcher@${version}`,
    sendDefaultPii: false,
    // The app-level listeners below attach a small, sanitized context. Keep
    // the SDK's global handlers disabled so one browser failure is not sent
    // twice.
    integrations: (integrations) =>
      integrations.filter((integration) => integration.name !== "GlobalHandlers"),
    beforeSend: (event, hint) => {
      if (isExpectedRendererError(hint?.originalException, event)) {
        return null;
      }

      return sanitizeSentryEvent(event);
    },
  });
  rendererSentryEnabled = true;
  return true;
}

export function registerRendererErrorHandlers(): () => void {
  if (typeof window === "undefined") {
    return () => undefined;
  }

  const onError = (event: ErrorEvent) => {
    reportRendererError(event.error ?? new Error(event.message || "uncaught renderer error"), {
      event: "window_error",
    });
  };
  const onUnhandledRejection = (event: PromiseRejectionEvent) => {
    reportRendererError(event.reason ?? new Error("unhandled promise rejection"), {
      event: "unhandled_rejection",
    });
  };

  window.addEventListener("error", onError);
  window.addEventListener("unhandledrejection", onUnhandledRejection);

  return () => {
    window.removeEventListener("error", onError);
    window.removeEventListener("unhandledrejection", onUnhandledRejection);
  };
}

export function reportRendererError(
  error: unknown,
  context?: Record<string, unknown>,
): void {
  if (isExpectedRendererError(error)) {
    return;
  }

  const safeContext = sanitizeValue(context);
  logRendererError(error, safeContext);

  if (!rendererSentryEnabled) {
    return;
  }

  Sentry.withScope((scope) => {
    if (isRecord(safeContext)) {
      scope.setExtras(safeContext);
    }
    Sentry.captureException(error);
  });
}

/** Writes an unexpected renderer failure to the local diagnostic pipeline. */
export function logRendererError(error: unknown, context?: unknown): void {
  const safeError = sanitizeValue(error);
  const safeContext = sanitizeValue(context);
  const errorMessage = isRecord(safeError)
    ? typeof safeError.message === "string"
      ? safeError.message
      : undefined
    : typeof safeError === "string"
      ? safeError
      : undefined;

  appLogger.error("renderer error", {
    event: "renderer_error",
    ...(isRecord(safeContext) ? safeContext : {}),
    ...(errorMessage === undefined ? {} : { message: errorMessage }),
  });
}

export function sanitizeSentryEvent<T>(event: T): T {
  if (!isRecord(event)) {
    return event;
  }

  const sanitized = { ...event } as Record<string, unknown>;
  const allowedKeys = new Set([
    "breadcrumbs",
    "contexts",
    "dist",
    "environment",
    "event_id",
    "exception",
    "extra",
    "fingerprint",
    "level",
    "message",
    "platform",
    "release",
    "request",
    "tags",
    "timestamp",
    "transaction",
  ]);

  for (const key of Object.keys(sanitized)) {
    if (!allowedKeys.has(key)) {
      delete sanitized[key];
    }
  }

  if ("message" in sanitized && typeof sanitized.message === "string") {
    sanitized.message = sanitizeText(sanitized.message);
  }
  if ("transaction" in sanitized && typeof sanitized.transaction === "string") {
    sanitized.transaction = sanitizeText(sanitized.transaction);
  }
  if ("extra" in sanitized) {
    sanitized.extra = sanitizeValue(sanitized.extra);
  }
  if ("tags" in sanitized) {
    sanitized.tags = sanitizeValue(sanitized.tags);
  }
  if ("contexts" in sanitized) {
    sanitized.contexts = sanitizeValue(sanitized.contexts);
  }
  if ("request" in sanitized) {
    sanitized.request = sanitizeRequest(sanitized.request);
  }
  if ("exception" in sanitized) {
    sanitized.exception = sanitizeException(sanitized.exception);
  }

  // Breadcrumbs can contain arbitrary network payloads and are not needed for
  // this desktop support flow.
  delete sanitized.breadcrumbs;

  return sanitized as T;
}

function sanitizeRequest(value: unknown): unknown {
  if (!isRecord(value)) {
    return undefined;
  }

  const url = typeof value.url === "string" ? pathOnly(value.url) : undefined;
  return {
    method: typeof value.method === "string" ? sanitizeText(value.method) : undefined,
    url,
  };
}

function sanitizeException(value: unknown): unknown {
  if (!isRecord(value) || !Array.isArray(value.values)) {
    return undefined;
  }

  return {
    values: value.values.flatMap((entry) => {
      if (!isRecord(entry)) {
        return [];
      }

      return [
        {
          type: typeof entry.type === "string" ? sanitizeText(entry.type) : undefined,
          value: typeof entry.value === "string" ? sanitizeText(entry.value) : undefined,
        },
      ];
    }),
  };
}

function pathOnly(value: string): string {
  try {
    return sanitizeText(new URL(value).pathname);
  } catch {
    return sanitizeText(value.split(/[?#]/, 1)[0] ?? "");
  }
}

function isExpectedRendererError(error: unknown, event?: unknown): boolean {
  if (isRecord(error)) {
    if (error.name === "AbortError" || error.code === "cancelled" || error.code === "canceled") {
      return true;
    }

    if (typeof error.status === "number" && [401, 409, 422].includes(error.status)) {
      return true;
    }
  }

  if (isRecord(event) && isRecord(event.tags) && typeof event.tags.status === "number") {
    return [401, 409, 422].includes(event.tags.status);
  }

  return false;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
