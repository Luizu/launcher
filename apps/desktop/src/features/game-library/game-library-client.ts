import type { GameLibraryResponse, SyncLibraryResult } from "@launcher/contracts";
import { ApiClient } from "../../lib/api-client";

/**
 * The slice of {@link GameLibraryClient} the library UI needs, exposed so
 * components and hooks can inject fakes in tests.
 */
export interface GameLibraryClientLike {
  sync(): Promise<SyncLibraryResult>;
  list(): Promise<GameLibraryResponse>;
}

/**
 * Typed client for the game-library endpoints. All HTTP for the remote
 * library lives here; components never call `fetch` directly.
 */
export class GameLibraryClient implements GameLibraryClientLike {
  constructor(private readonly api: ApiClient) {}

  async sync(): Promise<SyncLibraryResult> {
    return this.api.request<SyncLibraryResult>("/api/game-library/sync", {
      method: "POST",
    });
  }

  async list(): Promise<GameLibraryResponse> {
    return this.api.request<GameLibraryResponse>("/api/game-library");
  }
}
