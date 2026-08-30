export type PlatformId = "steam" | (string & {});

export type PlatformLinkAttemptState =
  | "pending"
  | "completed"
  | "expired"
  | "failed";

export interface AuthorizationRequest {
  authorizationUrl: string;
}

export interface ExternalAccount {
  provider: PlatformId;
  externalAccountId: string;
}

export interface LinkAttemptStatus {
  attemptId: string;
  provider: PlatformId;
  status: PlatformLinkAttemptState;
  expiresAt: string;
  completedAt: string | null;
}

export interface StartPlatformLinkResponse {
  attemptId: string;
  authorizationUrl: string;
}
