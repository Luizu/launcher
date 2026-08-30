import type { SessionResponse, SignInInput, SignUpInput } from "@launcher/contracts";
import { ApiClient } from "./api-client";

/**
 * Auth client over the Better Auth endpoints.
 *
 * Password hashing, token rotation, and session persistence live entirely in
 * the API's Better Auth integration; this client only routes the wire
 * endpoints and carries the session cookie automatically through
 * {@link ApiClient}.
 */
export class AuthClient {
  constructor(private readonly api: ApiClient) {}

  async signUp(input: SignUpInput): Promise<SessionResponse> {
    return this.api.request<SessionResponse>("/api/auth/sign-up/email", {
      method: "POST",
      body: JSON.stringify(input),
    });
  }

  async signIn(input: SignInInput): Promise<SessionResponse> {
    return this.api.request<SessionResponse>("/api/auth/sign-in/email", {
      method: "POST",
      body: JSON.stringify(input),
    });
  }

  async signOut(): Promise<void> {
    await this.api.request<{ success: boolean }>("/api/auth/sign-out", {
      method: "POST",
    });
  }

  async getSession(): Promise<SessionResponse | null> {
    return this.api.request<SessionResponse | null>("/api/auth/get-session", {
      method: "GET",
    });
  }
}
