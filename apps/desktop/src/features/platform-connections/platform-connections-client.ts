import type {
  LinkAttemptStatus,
  StartPlatformLinkResponse,
} from "@fuse-launcher/contracts";
import { ApiClient } from "../../lib/api-client";

/**
 * The slice of {@link PlatformConnectionsClient} the connection flow needs,
 * exposed so components and hooks can inject fakes in tests.
 */
export interface PlatformConnectionsClientLike {
  startSteamLink(): Promise<StartPlatformLinkResponse>;
  getSteamLinkStatus(attemptId: string): Promise<LinkAttemptStatus>;
}

/**
 * Typed client for the platform-connection endpoints. All HTTP for the Steam
 * link flow lives here; the card and hook never call `fetch` directly.
 */
export class PlatformConnectionsClient implements PlatformConnectionsClientLike {
  constructor(private readonly api: ApiClient) {}

  async startSteamLink(): Promise<StartPlatformLinkResponse> {
    return this.api.request<StartPlatformLinkResponse>(
      "/api/platform-connections/steam/link",
      { method: "POST" },
    );
  }

  async getSteamLinkStatus(attemptId: string): Promise<LinkAttemptStatus> {
    return this.api.request<LinkAttemptStatus>(
      `/api/platform-connections/steam/link/${encodeURIComponent(attemptId)}`,
    );
  }
}
