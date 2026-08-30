import type { LaunchHistory } from "@launcher/contracts";
import { TauriClient } from "../../lib/tauri-client";

/**
 * The slice of {@link TauriClient} the launch history needs, exposed so the
 * hook and tests can inject fakes.
 */
export interface LaunchHistoryClientLike {
  getHistory(): Promise<LaunchHistory>;
}

/**
 * Typed client for the desktop-local launch history. The history is read
 * through Tauri IPC only — it never crosses the HTTP layer.
 */
export class LaunchHistoryClient implements LaunchHistoryClientLike {
  constructor(private readonly tauri: TauriClient) {}

  getHistory(): Promise<LaunchHistory> {
    return this.tauri.getLaunchHistory();
  }
}
