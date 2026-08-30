import type { GamePageResponse } from "@launcher/contracts";
import { ApiClient } from "../../lib/api-client";

/**
 * The slice of {@link GamePagesClient} the game page needs, exposed so
 * components and hooks can inject fakes in tests.
 */
export interface GamePagesClientLike {
  getGamePage(identityId: string): Promise<GamePageResponse>;
}

/**
 * Typed client for the game-pages endpoint. All HTTP for game pages lives
 * here; components never call `fetch` directly.
 */
export class GamePagesClient implements GamePagesClientLike {
  constructor(private readonly api: ApiClient) {}

  getGamePage(identityId: string): Promise<GamePageResponse> {
    return this.api.request<GamePageResponse>(
      `/api/game-pages/${encodeURIComponent(identityId)}`,
    );
  }
}
