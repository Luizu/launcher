import type { LocalLibrarySnapshot } from "@launcher/contracts";
import { TauriClient } from "../../lib/tauri-client";

/**
 * The slice of the local library the UI needs, exposed so components and
 * hooks can inject fakes in tests.
 */
export interface LocalLibraryClientLike {
  scan(): Promise<LocalLibrarySnapshot>;
}

/**
 * Typed client for the local Steam snapshot. All Tauri IPC for the scan
 * lives here; components never call `invoke` directly.
 */
export class LocalLibraryClient implements LocalLibraryClientLike {
  constructor(private readonly tauri: TauriClient) {}

  scan(): Promise<LocalLibrarySnapshot> {
    return this.tauri.scanLocalLibrary();
  }
}
