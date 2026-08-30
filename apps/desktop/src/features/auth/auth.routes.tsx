import type { ReactNode } from "react";
import { Navigate, type RouteObject } from "react-router-dom";
import { AuthPage, SessionLoading } from "./auth-page";
import { useSession } from "./use-session";

/**
 * Waits for the session check before redirecting: a signed-in user visiting
 * `/auth` goes to `/library`, and a signed-out user visiting a protected
 * route goes to `/auth`.
 */
export function RequireGuest({ children }: { children: ReactNode }) {
  const { session, isLoading } = useSession();
  if (isLoading) return <SessionLoading />;
  if (session) return <Navigate to="/library" replace />;
  return <>{children}</>;
}

export function RequireSession({ children }: { children: ReactNode }) {
  const { session, isLoading } = useSession();
  if (isLoading) return <SessionLoading />;
  if (!session) return <Navigate to="/auth" replace />;
  return <>{children}</>;
}

export const authRoutes: RouteObject[] = [
  {
    path: "auth",
    element: (
      <RequireGuest>
        <AuthPage />
      </RequireGuest>
    ),
  },
];
