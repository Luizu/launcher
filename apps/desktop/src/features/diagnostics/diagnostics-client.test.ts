import { describe, expect, it, vi } from "vitest";
import { TauriClient, TauriClientError } from "../../lib/tauri-client";
import { DiagnosticsClient } from "./diagnostics-client";

describe("DiagnosticsClient", () => {
  it("opens logs through Tauri when running as a desktop app", async () => {
    const openLogs = vi.spyOn(TauriClient.prototype, "openLogs").mockResolvedValue(undefined);
    const client = new DiagnosticsClient(new TauriClient(), true);

    await client.openLogs();

    expect(openLogs).toHaveBeenCalledOnce();
    openLogs.mockRestore();
  });

  it("returns a stable browser error outside Tauri", async () => {
    const client = new DiagnosticsClient(new TauriClient(), false);

    await expect(client.openLogs()).rejects.toEqual(
      new TauriClientError(
        "diagnostics-unavailable",
        "logs are available from the packaged desktop application",
      ),
    );
  });
});
