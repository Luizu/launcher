import type { PlatformId } from "./platform-connections";

/**
 * One recorded local launch: the provider entry and the last launch instant.
 *
 * The history is desktop-local by design: it is served by the native
 * `launch_history_get` command and is never included in any API request.
 */
export interface LaunchHistoryEntry {
  provider: PlatformId;
  externalGameId: number;
  /** Instant of the last completed launch, ISO 8601 UTC. */
  lastLaunchedAt: string;
}

/**
 * The local launch history snapshot served by the native runtime.
 */
export interface LaunchHistory {
  entries: ReadonlyArray<LaunchHistoryEntry>;
}
