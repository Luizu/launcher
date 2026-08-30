import {
  debug as nativeDebug,
  error as nativeError,
  info as nativeInfo,
  warn as nativeWarn,
} from "@tauri-apps/plugin-log";
import { sanitizeText, sanitizeValue } from "./sanitize";

export interface AppLogger {
  debug(message: string, context?: unknown): void;
  info(message: string, context?: unknown): void;
  warn(message: string, context?: unknown): void;
  error(message: string, context?: unknown): void;
}

type LogLevel = keyof AppLogger;
type LogBridge = Record<LogLevel, (message: string) => Promise<void>>;

const nativeBridge: LogBridge = {
  debug: nativeDebug,
  info: nativeInfo,
  warn: nativeWarn,
  error: nativeError,
};

export function createAppLogger(bridge: LogBridge = nativeBridge): AppLogger {
  return {
    debug: (message, context) => write("debug", message, context, bridge),
    info: (message, context) => write("info", message, context, bridge),
    warn: (message, context) => write("warn", message, context, bridge),
    error: (message, context) => write("error", message, context, bridge),
  };
}

export const appLogger = createAppLogger();

function write(
  level: LogLevel,
  message: string,
  context: unknown,
  bridge: LogBridge,
): void {
  const entry = {
    level,
    message: sanitizeText(message),
    ...(context === undefined ? {} : { context: sanitizeValue(context) }),
  };
  const line = JSON.stringify(entry);

  writeToConsole(level, line);

  if (!isTauriRuntime()) {
    return;
  }

  try {
    void bridge[level](line).catch(() => undefined);
  } catch {
    // Logging is best-effort. A broken native bridge must not break the app.
  }
}

function writeToConsole(level: LogLevel, line: string): void {
  switch (level) {
    case "debug":
      console.debug(line);
      return;
    case "info":
      console.info(line);
      return;
    case "warn":
      console.warn(line);
      return;
    case "error":
      console.error(line);
      return;
  }
}

function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}
