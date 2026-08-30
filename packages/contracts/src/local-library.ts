import type { PlatformId } from "./platform-connections";

/**
 * Local installation state reported by the native scan.
 *
 * Mirrors the Rust `LocalInstallStateDto` wire values (lowercase).
 */
export type LocalInstallState = "installed" | "installing" | "unknown";

/**
 * One normalized local game from a native snapshot. Contains no absolute
 * path; games are identified by provider and numeric AppID only.
 */
export interface LocalGame {
  provider: PlatformId;
  externalGameId: number;
  name: string;
  state: LocalInstallState;
}

/**
 * A diagnostic for a skipped or inconsistent manifest; carries only the
 * manifest file name, never a full path.
 */
export interface LocalScanDiagnostic {
  manifest: string;
  message: string;
}

/**
 * The scan result sent from the native runtime to the frontend: normalized
 * games plus skipped-manifest diagnostics.
 */
export interface LocalLibrarySnapshot {
  games: ReadonlyArray<LocalGame>;
  diagnostics: ReadonlyArray<LocalScanDiagnostic>;
}

/**
 * Result of an accepted launch or install request.
 */
export interface ActionAccepted {
  accepted: boolean;
}

/**
 * Install state reported by the native runtime for a single game.
 */
export interface InstallStatus {
  state: LocalInstallState;
}
