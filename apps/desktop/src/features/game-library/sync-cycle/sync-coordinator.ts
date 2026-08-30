import type { PlatformId, SyncLibraryResult } from "@launcher/contracts";

export type SyncRunner = () => Promise<SyncLibraryResult>;

/**
 * Coordinates sync requests per provider so concurrent triggers — open,
 * window focus, the periodic cadence, and manual retries — never create
 * duplicate network calls: the first runner for a provider executes, later
 * triggers receive the same promise. The in-flight record is removed once
 * the promise settles (success or failure), so the next trigger starts a
 * fresh sync.
 *
 * Server-side concurrency is out of scope by design: the API's replace
 * transaction is atomic per request, and this coordinator guarantees the
 * desktop never has more than one in-flight sync per provider.
 */
export class SyncCoordinator {
  private readonly inFlight = new Map<PlatformId, Promise<SyncLibraryResult>>();

  /** True while a sync for the provider has not settled yet. */
  isInFlight(provider: PlatformId): boolean {
    return this.inFlight.has(provider);
  }

  /**
   * Runs `run` for the provider unless one is already in flight, in which
   * case the existing promise is returned unchanged (the runner is never
   * called twice for the same provider at the same time).
   */
  sync(provider: PlatformId, run: SyncRunner): Promise<SyncLibraryResult> {
    const existing = this.inFlight.get(provider);
    if (existing !== undefined) return existing;

    let promise: Promise<SyncLibraryResult>;
    try {
      promise = run();
    } catch (error) {
      // A runner that throws synchronously never started a request; surface
      // the rejection without leaving a stale in-flight record behind.
      return Promise.reject(error);
    }
    const tracked = promise.finally(() => {
      this.inFlight.delete(provider);
    });
    this.inFlight.set(provider, tracked);
    return tracked;
  }
}

/**
 * Shared coordinator for the whole app: the connection card's manual retry
 * and the sync cycle both route through it, so every trigger deduplicates
 * against every other.
 */
export const defaultSyncCoordinator = new SyncCoordinator();
