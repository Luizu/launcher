import { beforeEach, describe, expect, it, vi } from "vitest";
import * as nativeLog from "@tauri-apps/plugin-log";
import { appLogger } from "./logger";

vi.mock("@tauri-apps/plugin-log", () => ({
  debug: vi.fn().mockResolvedValue(undefined),
  info: vi.fn().mockResolvedValue(undefined),
  warn: vi.fn().mockResolvedValue(undefined),
  error: vi.fn().mockResolvedValue(undefined),
}));

describe("renderer app logger", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    delete (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
  });

  it("writes only sanitized operational metadata", () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    appLogger.error("request failed", {
      event: "api_error",
      status: 503,
      route: "/api/library",
      token: "private-value",
    });

    expect(consoleError).toHaveBeenCalledWith(
      expect.stringContaining('"token":"[REDACTED]"'),
    );
    expect(consoleError.mock.calls[0]?.[0]).not.toContain("private-value");
  });

  it("forwards logs to Tauri without making a rejected bridge fatal", () => {
    Object.defineProperty(window, "__TAURI_INTERNALS__", {
      configurable: true,
      value: {},
    });
    vi.mocked(nativeLog.warn).mockRejectedValueOnce(new Error("bridge unavailable"));
    const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    expect(() => appLogger.warn("native bridge warning")).not.toThrow();
    expect(nativeLog.warn).toHaveBeenCalledWith(expect.stringContaining("native bridge warning"));
    expect(consoleWarn).toHaveBeenCalledOnce();
  });
});
