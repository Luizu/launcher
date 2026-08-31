import { invoke } from "@tauri-apps/api/core";
import type {
  ActionAccepted,
  InstallStatus,
  LaunchHistory,
  LocalLibrarySnapshot,
} from "@fuse-launcher/contracts";
import { reportRendererError } from "./observability/sentry";

/**
 * Typed error thrown by {@link TauriClient} for failed native commands.
 *
 * Carries the stable native error `code` (e.g. `steam-not-installed`,
 * `game-not-installed`) plus the native message. The raw rejection value is
 * never surfaced to feature code.
 */
export class TauriClientError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "TauriClientError";
    this.code = code;
  }
}

export type TauriInvoke = typeof invoke;

/**
 * Native command names in one constant object so feature modules can never
 * invent command strings; they only call the typed methods.
 */
const COMMANDS = {
  scanLocalLibrary: "local_library_scan",
  launch: "game_actions_launch",
  install: "game_actions_install",
  getInstallStatus: "game_actions_get_install_status",
  launchHistoryGet: "launch_history_get",
  openLogs: "diagnostics_open_logs",
} as const;

const EXPECTED_NATIVE_ERROR_CODES = new Set([
  "game-not-installed",
  "install-state-unknown",
  "invalid-app-id",
  "open-failed",
  "scan-failed",
  "status-refresh-failed",
  "steam-not-installed",
  "steam-path-not-found",
]);

/**
 * Typed client over the Tauri native commands.
 *
 * The invoker is constructor-injected so tests pass a fake; production uses
 * the real `@tauri-apps/api/core` binding. AppIDs are converted to positive
 * 32-bit integers before invoking (Tauri maps `appId` to the Rust `app_id`),
 * and native errors are mapped to a typed {@link TauriClientError}.
 */
export class TauriClient {
  constructor(private readonly invoker: TauriInvoke = invoke) {}

  scanLocalLibrary(): Promise<LocalLibrarySnapshot> {
    return this.run<LocalLibrarySnapshot>(COMMANDS.scanLocalLibrary);
  }

  async launch(appId: number): Promise<ActionAccepted> {
    return this.run<ActionAccepted>(COMMANDS.launch, {
      appId: this.toAppId(appId),
    });
  }

  async install(appId: number): Promise<ActionAccepted> {
    return this.run<ActionAccepted>(COMMANDS.install, {
      appId: this.toAppId(appId),
    });
  }

  async getInstallStatus(appId: number): Promise<InstallStatus> {
    return this.run<InstallStatus>(COMMANDS.getInstallStatus, {
      appId: this.toAppId(appId),
    });
  }

  /** The desktop-local launch history; never sent to any API. */
  getLaunchHistory(): Promise<LaunchHistory> {
    return this.run<LaunchHistory>(COMMANDS.launchHistoryGet);
  }

  /** Opens the native application log directory in the user's file manager. */
  openLogs(): Promise<void> {
    return this.run<void>(COMMANDS.openLogs);
  }

  private async run<T>(
    command: string,
    args?: Record<string, unknown>,
  ): Promise<T> {
    try {
      return args === undefined
        ? await this.invoker<T>(command)
        : await this.invoker<T>(command, args);
    } catch (error) {
      const mapped = this.mapError(error);
      if (isTauriRuntime() && !EXPECTED_NATIVE_ERROR_CODES.has(mapped.code)) {
        reportRendererError(mapped, {
          event: "tauri_command_failed",
          command,
          code: mapped.code,
        });
      }
      throw mapped;
    }
  }

  private toAppId(appId: number): number {
    const id = Math.trunc(appId);
    if (!Number.isFinite(appId) || id <= 0 || id > 0xffffffff) {
      throw new TauriClientError(
        "invalid-app-id",
        "the steam app id must be a positive 32-bit number",
      );
    }
    return id;
  }

  private mapError(error: unknown): TauriClientError {
    if (typeof error === "object" && error !== null) {
      const candidate = error as { code?: unknown; message?: unknown };
      if (typeof candidate.code === "string") {
        return new TauriClientError(
          candidate.code,
          typeof candidate.message === "string"
            ? candidate.message
            : candidate.code,
        );
      }
    }

    if (typeof error === "string") {
      try {
        const parsed = JSON.parse(error) as {
          code?: unknown;
          message?: unknown;
        };
        if (typeof parsed.code === "string") {
          return new TauriClientError(
            parsed.code,
            typeof parsed.message === "string" ? parsed.message : parsed.code,
          );
        }
      } catch {
        // Not a serialized error; treat the string as the message.
      }
      return new TauriClientError("native-command-failed", error);
    }

    return new TauriClientError(
      "native-command-failed",
      error instanceof Error ? error.message : "the native command failed",
    );
  }
}

function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}
