import type { SyncLibraryResult } from "@fuse-launcher/contracts";
import { SyncCoordinator } from "./sync-coordinator";

const SYNCED: SyncLibraryResult = { status: "synced" };

describe("SyncCoordinator", () => {
  it("coalesces concurrent syncs for the same provider onto one promise", async () => {
    const coordinator = new SyncCoordinator();
    let resolveSync!: (result: SyncLibraryResult) => void;
    const runner = vi.fn(
      () =>
        new Promise<SyncLibraryResult>((resolve) => {
          resolveSync = resolve;
        }),
    );

    const first = coordinator.sync("steam", runner);
    const second = coordinator.sync("steam", runner);
    const third = coordinator.sync("steam", runner);

    expect(runner).toHaveBeenCalledTimes(1);
    expect(second).toBe(first);
    expect(third).toBe(first);

    resolveSync(SYNCED);
    await expect(first).resolves.toEqual(SYNCED);
    await expect(second).resolves.toEqual(SYNCED);
    await expect(third).resolves.toEqual(SYNCED);
  });

  it("runs syncs for different providers concurrently", async () => {
    const coordinator = new SyncCoordinator();
    let resolveSteam!: (result: SyncLibraryResult) => void;
    let resolveEpic!: (result: SyncLibraryResult) => void;
    const steamRunner = vi.fn(
      () =>
        new Promise<SyncLibraryResult>((resolve) => {
          resolveSteam = resolve;
        }),
    );
    const epicRunner = vi.fn(
      () =>
        new Promise<SyncLibraryResult>((resolve) => {
          resolveEpic = resolve;
        }),
    );

    const steam = coordinator.sync("steam", steamRunner);
    const epic = coordinator.sync("epic", epicRunner);

    expect(steamRunner).toHaveBeenCalledTimes(1);
    expect(epicRunner).toHaveBeenCalledTimes(1);
    expect(steam).not.toBe(epic);

    resolveSteam(SYNCED);
    resolveEpic({ status: "private" });
    await expect(steam).resolves.toEqual(SYNCED);
    await expect(epic).resolves.toEqual({ status: "private" });
  });

  it("clears the in-flight record once a sync settles, so the next trigger runs again", async () => {
    const coordinator = new SyncCoordinator();
    const runner = vi.fn().mockResolvedValue(SYNCED);

    await coordinator.sync("steam", runner);
    expect(coordinator.isInFlight("steam")).toBe(false);

    await coordinator.sync("steam", runner);
    expect(runner).toHaveBeenCalledTimes(2);
  });

  it("clears the in-flight record when a sync fails", async () => {
    const coordinator = new SyncCoordinator();
    const runner = vi.fn().mockRejectedValue(new Error("provider down"));

    await expect(coordinator.sync("steam", runner)).rejects.toThrow("provider down");
    expect(coordinator.isInFlight("steam")).toBe(false);

    const recoveryRunner = vi.fn().mockResolvedValue(SYNCED);
    await expect(coordinator.sync("steam", recoveryRunner)).resolves.toEqual(SYNCED);
    expect(recoveryRunner).toHaveBeenCalledTimes(1);
  });

  it("does not leave a stale record when the runner throws synchronously", async () => {
    const coordinator = new SyncCoordinator();
    const runner = vi.fn().mockImplementation(() => {
      throw new Error("boom");
    });

    await expect(coordinator.sync("steam", runner)).rejects.toThrow("boom");
    expect(coordinator.isInFlight("steam")).toBe(false);

    const recoveryRunner = vi.fn().mockResolvedValue(SYNCED);
    await expect(coordinator.sync("steam", recoveryRunner)).resolves.toEqual(SYNCED);
  });
});
