import { TauriClient, TauriClientError } from "../../lib/tauri-client";

export interface DiagnosticsClientLike {
  openLogs(): Promise<void>;
}

/**
 * Coordinates diagnostics actions that only exist in the packaged desktop
 * runtime. The browser/dev server gets a stable, safe error instead of a
 * failed Tauri invocation.
 */
export class DiagnosticsClient implements DiagnosticsClientLike {
  constructor(
    private readonly nativeClient: DiagnosticsClientLike = new TauriClient(),
    private readonly desktopRuntime = isTauriRuntime(),
  ) {}

  openLogs(): Promise<void> {
    if (!this.desktopRuntime) {
      return Promise.reject(
        new TauriClientError(
          "diagnostics-unavailable",
          "logs are available from the packaged desktop application",
        ),
      );
    }

    return this.nativeClient.openLogs();
  }
}

export const diagnosticsClient = new DiagnosticsClient();

function isTauriRuntime(): boolean {
  return (
    typeof window !== "undefined" &&
    "__TAURI_INTERNALS__" in window
  );
}
