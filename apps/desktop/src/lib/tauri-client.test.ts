import { beforeEach, describe, expect, it, vi } from "vitest";
import { TauriClient } from "./tauri-client";
import * as rendererObservability from "./observability/sentry";

vi.mock("./observability/sentry", () => ({
  reportRendererError: vi.fn(),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe("TauriClient", () => {
  it("maps a Tauri command to the native client", async () => {
    const invoke = vi.fn().mockResolvedValue({ games: [] });
    const client = new TauriClient(invoke);

    await client.scanLocalLibrary();

    expect(invoke).toHaveBeenCalledWith("local_library_scan");
  });

  it("converts a non-integer app id to an integer before invoking launch", async () => {
    const invoke = vi.fn().mockResolvedValue({ accepted: true });
    const client = new TauriClient(invoke);

    await client.launch(730.7);

    expect(invoke).toHaveBeenCalledWith("game_actions_launch", { appId: 730 });
  });

  it("invokes install with the app id converted to an integer", async () => {
    const invoke = vi.fn().mockResolvedValue({ accepted: true });
    const client = new TauriClient(invoke);

    await client.install(730);

    expect(invoke).toHaveBeenCalledWith("game_actions_install", { appId: 730 });
  });

  it("returns the native install status", async () => {
    const invoke = vi.fn().mockResolvedValue({ state: "installing" });
    const client = new TauriClient(invoke);

    await expect(client.getInstallStatus(730)).resolves.toEqual({ state: "installing" });

    expect(invoke).toHaveBeenCalledWith("game_actions_get_install_status", { appId: 730 });
  });

  it("maps a serialized native error to a typed TauriClientError", async () => {
    const invoke = vi.fn().mockRejectedValue({
      code: "steam-not-installed",
      message: "steam is not installed or no library could be found",
    });
    const client = new TauriClient(invoke);

    await expect(client.scanLocalLibrary()).rejects.toMatchObject({
      name: "TauriClientError",
      code: "steam-not-installed",
      message: "steam is not installed or no library could be found",
    });
  });

  it("maps a stringified native error to a typed TauriClientError", async () => {
    const invoke = vi.fn().mockRejectedValue(
      JSON.stringify({ code: "game-not-installed", message: "the game is not in the local installed snapshot" }),
    );
    const client = new TauriClient(invoke);

    await expect(client.launch(730)).rejects.toMatchObject({
      name: "TauriClientError",
      code: "game-not-installed",
      message: "the game is not in the local installed snapshot",
    });
  });

  it("maps an unknown rejection to a stable TauriClientError", async () => {
    const invoke = vi.fn().mockRejectedValue(new Error("boom"));
    const client = new TauriClient(invoke);
    Object.defineProperty(window, "__TAURI_INTERNALS__", {
      configurable: true,
      value: {},
    });

    try {
      await expect(client.install(730)).rejects.toMatchObject({
        name: "TauriClientError",
        code: "native-command-failed",
      });

      expect(rendererObservability.reportRendererError).toHaveBeenCalledWith(
        expect.objectContaining({ code: "native-command-failed" }),
        {
          event: "tauri_command_failed",
          command: "game_actions_install",
          code: "native-command-failed",
        },
      );
    } finally {
      Reflect.deleteProperty(window, "__TAURI_INTERNALS__");
    }
  });

  it("does not report native invocation failures outside the Tauri runtime", async () => {
    const invoke = vi.fn().mockRejectedValue(new Error("Tauri is unavailable"));
    const client = new TauriClient(invoke);

    await expect(client.install(730)).rejects.toMatchObject({
      code: "native-command-failed",
    });

    expect(rendererObservability.reportRendererError).not.toHaveBeenCalled();
  });

  it("does not report expected local Steam state as an incident", async () => {
    const invoke = vi.fn().mockRejectedValue({
      code: "steam-not-installed",
      message: "steam is not installed",
    });
    const client = new TauriClient(invoke);

    await expect(client.scanLocalLibrary()).rejects.toMatchObject({
      code: "steam-not-installed",
    });

    expect(rendererObservability.reportRendererError).not.toHaveBeenCalled();
  });

  it("refuses to invoke with a non-positive app id", async () => {
    const invoke = vi.fn();
    const client = new TauriClient(invoke);

    await expect(client.launch(-1)).rejects.toMatchObject({
      name: "TauriClientError",
      code: "invalid-app-id",
    });
    expect(invoke).not.toHaveBeenCalled();
  });

  it("refuses to invoke with an app id above the 32-bit range", async () => {
    const invoke = vi.fn();
    const client = new TauriClient(invoke);

    await expect(client.launch(0x1_0000_0000)).rejects.toMatchObject({
      name: "TauriClientError",
      code: "invalid-app-id",
    });
    expect(invoke).not.toHaveBeenCalled();
  });

  it("accepts an app id at the top of the 32-bit range", async () => {
    const invoke = vi.fn().mockResolvedValue({ accepted: true });
    const client = new TauriClient(invoke);

    await client.launch(0xffffffff);

    expect(invoke).toHaveBeenCalledWith("game_actions_launch", {
      appId: 0xffffffff,
    });
  });

  it("fetches the local launch history without arguments", async () => {
    const invoke = vi.fn().mockResolvedValue({
      entries: [
        {
          provider: "steam",
          externalGameId: 730,
          lastLaunchedAt: "2026-08-29T14:07:39Z",
        },
      ],
    });
    const client = new TauriClient(invoke);

    await expect(client.getLaunchHistory()).resolves.toEqual({
      entries: [
        {
          provider: "steam",
          externalGameId: 730,
          lastLaunchedAt: "2026-08-29T14:07:39Z",
        },
      ],
    });
    expect(invoke).toHaveBeenCalledWith("launch_history_get");
  });

  it("opens the native log directory through the diagnostics command", async () => {
    const invoke = vi.fn().mockResolvedValue(undefined);
    const client = new TauriClient(invoke);

    await client.openLogs();

    expect(invoke).toHaveBeenCalledWith("diagnostics_open_logs");
  });
});
