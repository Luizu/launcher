import { check as checkForUpdate, type DownloadEvent } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { reportRendererError } from "../../lib/observability/sentry";

export type UpdateStatus =
  | "disabled"
  | "idle"
  | "checking"
  | "up-to-date"
  | "available"
  | "installing"
  | "ready"
  | "error";

export interface UpdateHandle {
  currentVersion: string;
  version: string;
  date?: string;
  body?: string;
  downloadAndInstall: (
    onEvent?: (event: DownloadEvent) => void,
  ) => Promise<void>;
}

export interface UpdaterRuntime {
  check(): Promise<UpdateHandle | null>;
  relaunch(): Promise<void>;
}

export interface UpdateSnapshot {
  status: UpdateStatus;
  currentVersion: string;
  availableVersion: string | null;
  releaseDate: string | null;
  releaseNotes: string | null;
  progress: number | null;
  error: string | null;
}

export type UpdateListener = (snapshot: UpdateSnapshot) => void;

export class UpdaterClientError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "UpdaterClientError";
    this.code = code;
  }
}

const UPDATE_CHECK_FAILED = "Não foi possível verificar atualizações.";
const UPDATE_INSTALL_FAILED = "Não foi possível instalar a atualização.";
const NO_UPDATE_AVAILABLE = "Nenhuma atualização disponível.";

const tauriUpdaterRuntime: UpdaterRuntime = {
  check: checkForUpdate,
  relaunch,
};

/**
 * Thin, testable boundary around the Tauri updater plugin. It is disabled for
 * browser/dev builds and never exposes raw updater or release payloads to the
 * rest of the UI.
 */
export class UpdaterClient {
  private readonly listeners = new Set<UpdateListener>();
  private pendingUpdate: UpdateHandle | null = null;
  private inFlightCheck: Promise<UpdateSnapshot> | null = null;
  private snapshot: UpdateSnapshot;

  constructor(
    private readonly runtime: UpdaterRuntime = tauriUpdaterRuntime,
    options: { enabled?: boolean; currentVersion?: string } = {},
  ) {
    const currentVersion = options.currentVersion ?? getBuildVersion();
    const enabled = options.enabled ?? (isTauriRuntime() && import.meta.env.PROD);
    this.snapshot = {
      status: enabled ? "idle" : "disabled",
      currentVersion,
      availableVersion: null,
      releaseDate: null,
      releaseNotes: null,
      progress: null,
      error: null,
    };
  }

  getSnapshot(): UpdateSnapshot {
    return { ...this.snapshot };
  }

  subscribe(listener: UpdateListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  check(): Promise<UpdateSnapshot> {
    if (this.snapshot.status === "disabled") {
      return Promise.resolve(this.getSnapshot());
    }

    if (this.inFlightCheck !== null) {
      return this.inFlightCheck;
    }

    const checkPromise = this.performCheck();
    const trackedCheck = checkPromise.finally(() => {
      if (this.inFlightCheck === trackedCheck) {
        this.inFlightCheck = null;
      }
    });
    this.inFlightCheck = trackedCheck;
    return trackedCheck;
  }

  private async performCheck(): Promise<UpdateSnapshot> {
    this.setSnapshot({ status: "checking", error: null, progress: null });
    try {
      const update = await this.runtime.check();
      this.pendingUpdate = update;

      if (update === null) {
        this.setSnapshot({
          status: "up-to-date",
          availableVersion: null,
          releaseDate: null,
          releaseNotes: null,
          progress: null,
          error: null,
        });
      } else {
        this.setSnapshot({
          status: "available",
          currentVersion: update.currentVersion || this.snapshot.currentVersion,
          availableVersion: update.version,
          releaseDate: update.date ?? null,
          releaseNotes: update.body ?? null,
          progress: null,
          error: null,
        });
      }
      return this.getSnapshot();
    } catch {
      const error = new UpdaterClientError("update-check-failed", UPDATE_CHECK_FAILED);
      reportRendererError(error, {
        event: "updater_check_failed",
        code: error.code,
        version: this.snapshot.currentVersion,
      });
      this.pendingUpdate = null;
      this.setSnapshot({ status: "error", error: error.message, progress: null });
      throw error;
    }
  }

  async install(): Promise<void> {
    const update = this.pendingUpdate;
    if (this.snapshot.status === "disabled" || update === null) {
      throw new UpdaterClientError("no-update-available", NO_UPDATE_AVAILABLE);
    }

    let downloadedBytes = 0;
    let contentLength: number | undefined;
    this.setSnapshot({ status: "installing", progress: 0, error: null });

    try {
      await update.downloadAndInstall((event) => {
        if (event.event === "Started") {
          contentLength = event.data.contentLength;
          downloadedBytes = 0;
          this.setSnapshot({ progress: contentLength ? 0 : null });
          return;
        }

        if (event.event === "Progress") {
          downloadedBytes += event.data.chunkLength;
          const progress = contentLength
            ? Math.min(100, Math.round((downloadedBytes / contentLength) * 100))
            : null;
          this.setSnapshot({ progress });
          return;
        }

        this.setSnapshot({ progress: 100 });
      });

      this.setSnapshot({ status: "ready", progress: 100 });
      await this.runtime.relaunch();
    } catch {
      const error = new UpdaterClientError("update-install-failed", UPDATE_INSTALL_FAILED);
      reportRendererError(error, { event: "updater_install_failed" });
      this.setSnapshot({ status: "error", error: error.message });
      throw error;
    }
  }

  private setSnapshot(changes: Partial<UpdateSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...changes };
    for (const listener of this.listeners) {
      listener(this.getSnapshot());
    }
  }
}

export const updaterClient = new UpdaterClient();

function getBuildVersion(): string {
  return import.meta.env.VITE_APP_VERSION ?? "desconhecida";
}

function isTauriRuntime(): boolean {
  return (
    typeof window !== "undefined" &&
    "__TAURI_INTERNALS__" in window
  );
}
