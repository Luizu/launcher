import { describe, expect, it } from "vitest";
import type { GamePageResponse } from "@fuse-launcher/contracts";
import { ApiClient } from "../../lib/api-client";
import { GamePagesClient } from "./game-page-client";

const PAGE: GamePageResponse = {
  identity: { id: "identity-1", name: "Counter-Strike 2", media: {} },
  entries: [],
};

describe("GamePagesClient", () => {
  it("requests the game page for the identity id", async () => {
    const fetcher = vi.fn(async () =>
      new Response(JSON.stringify(PAGE), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    const client = new GamePagesClient(
      new ApiClient("http://localhost:3000", fetcher as typeof fetch),
    );

    const page = await client.getGamePage("identity-1");

    expect(fetcher).toHaveBeenCalledWith(
      "http://localhost:3000/api/game-pages/identity-1",
      expect.objectContaining({ credentials: "include" }),
    );
    expect(page.identity.name).toBe("Counter-Strike 2");
  });

  it("encodes the identity id into the path", async () => {
    const fetcher = vi.fn(async () =>
      new Response(JSON.stringify(PAGE), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    const client = new GamePagesClient(
      new ApiClient("http://localhost:3000", fetcher as typeof fetch),
    );

    await client.getGamePage("abc 123");

    expect(fetcher).toHaveBeenCalledWith(
      "http://localhost:3000/api/game-pages/abc%20123",
      expect.anything(),
    );
  });
});
