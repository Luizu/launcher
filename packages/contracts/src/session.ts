/**
 * Wire shapes for the Better Auth session endpoints.
 *
 * Password hashing and session handling live entirely in the API's Better
 * Auth integration; these types only describe the JSON the desktop receives
 * from `/api/auth/*` so clients can type their responses without importing
 * better-auth itself.
 */

export interface AuthSessionUser {
  id: string;
  email: string;
  emailVerified: boolean;
  name: string | null;
  image: string | null;
}

export interface AuthSession {
  id: string;
  token: string;
  userId: string;
  expiresAt: string;
  createdAt: string;
  updatedAt: string;
  ipAddress?: string | null;
  userAgent?: string | null;
}

/** The session payload returned by sign-up, sign-in, and get-session. */
export interface SessionResponse {
  user: AuthSessionUser;
  session: AuthSession;
}

export interface SignUpInput {
  email: string;
  password: string;
  name?: string;
}

export interface SignInInput {
  email: string;
  password: string;
}
