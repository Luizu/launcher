import { beforeEach, describe, expect, it, vi } from "vitest";
import * as rendererObservability from "../../lib/observability/sentry";
import {
  UpdaterClient,
  type UpdaterRuntime,
  type UpdateHandle,
} from "./updater-client";

vi.mock("../../lib/observability/sentry", () => ({
  reportRendererError: vi.fn(),
}));

function createUpdate(overrides: Partial<UpdateHandle> = {}): UpdateHandle {
  return {
    currentVersion: "0.3.0",
    version: "0.4.0",
    date: "2026-08-30T12:00:00.000Z",
    body: "Correções importantes",
    downloadAndInstall: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function createRuntime(update: UpdateHandle | null): UpdaterRuntime {
  return {
    check: vi.fn().mockResolvedValue(update),
    relaunch: vi.fn().mockResolvedValue(undefined),
  };
}

describe("UpdaterClient", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("stays disabled outside a packaged desktop runtime", async () => {
    const runtime = createRuntime(null);
    const client = new UpdaterClient(runtime, {
      enabled: false,
      currentVersion: "0.3.0",
    });

    await expect(client.check()).resolves.toMatchObject({ status: "disabled" });
    expect(runtime.check).not.toHaveBeenCalled();
  });

  it("transitions to up-to-date when no release is available", async () => {
    const runtime = createRuntime(null);
    const client = new UpdaterClient(runtime, {
      enabled: true,
      currentVersion: "0.3.0",
    });

    await expect(client.check()).resolves.toMatchObject({
      status: "up-to-date",
      currentVersion: "0.3.0",
    });
    expect(runtime.check).toHaveBeenCalledOnce();
  });

  it("exposes safe release metadata and installs with download progress", async () => {
    let handle: UpdateHandle | undefined;
    const runtime = createRuntime(null);
    runtime.check = vi.fn().mockImplementation(async () => {
      handle = createUpdate();
      return handle;
    });
    const client = new UpdaterClient(runtime, {
      enabled: true,
      currentVersion: "0.3.0",
    });

    await client.check();
    expect(client.getSnapshot()).toMatchObject({
      status: "available",
      availableVersion: "0.4.0",
      releaseNotes: "Correções importantes",
      releaseDate: "2026-08-30T12:00:00.000Z",
      progress: null,
    });

    const progress: number[] = [];
    const downloadAndInstall = handle?.downloadAndInstall as ReturnType<typeof vi.fn>;
    downloadAndInstall.mockImplementation(async (onEvent: (event: unknown) => void) => {
      onEvent({ event: "Started", data: { contentLength: 100 } });
      onEvent({ event: "Progress", data: { chunkLength: 25 } });
      progress.push(client.getSnapshot().progress ?? -1);
      onEvent({ event: "Progress", data: { chunkLength: 75 } });
      onEvent({ event: "Finished" });
    });

    await client.install();

    expect(progress).toEqual([25]);
    expect(downloadAndInstall).toHaveBeenCalledOnce();
    expect(runtime.relaunch).toHaveBeenCalledOnce();
    expect(client.getSnapshot()).toMatchObject({ status: "ready", progress: 100 });
  });

  it("maps updater failures to a stable error without exposing raw details", async () => {
    const runtime: UpdaterRuntime = {
      check: vi.fn().mockRejectedValue(new Error("secret update endpoint")),
      relaunch: vi.fn(),
    };
    const client = new UpdaterClient(runtime, {
      enabled: true,
      currentVersion: "0.3.0",
    });

    await expect(client.check()).rejects.toMatchObject({
      code: "update-check-failed",
      message: "Não foi possível verificar atualizações.",
    });
    expect(client.getSnapshot()).toMatchObject({
      status: "error",
      error: "Não foi possível verificar atualizações.",
    });
    expect(rendererObservability.reportRendererError).toHaveBeenCalledWith(
      expect.objectContaining({ code: "update-check-failed" }),
      {
        event: "updater_check_failed",
        code: "update-check-failed",
        version: "0.3.0",
      },
    );
  });

  it("shares one in-flight check between automatic and manual callers", async () => {
    let resolveCheck: ((update: UpdateHandle | null) => void) | undefined;
    const runtime: UpdaterRuntime = {
      check: vi.fn(
        () =>
          new Promise<UpdateHandle | null>((resolve) => {
            resolveCheck = resolve;
          }),
      ),
      relaunch: vi.fn(),
    };
    const client = new UpdaterClient(runtime, {
      enabled: true,
      currentVersion: "0.3.0",
    });

    const firstCheck = client.check();
    const secondCheck = client.check();
    expect(runtime.check).toHaveBeenCalledOnce();

    resolveCheck?.(null);
    await expect(Promise.all([firstCheck, secondCheck])).resolves.toEqual([
      expect.objectContaining({ status: "up-to-date" }),
      expect.objectContaining({ status: "up-to-date" }),
    ]);
  });
});
