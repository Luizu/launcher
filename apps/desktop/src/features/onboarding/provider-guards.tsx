import type { ReactNode } from "react";
import { Navigate } from "react-router-dom";
import type { GameLibraryClientLike } from "../game-library/game-library-client";
import { useGameLibrary } from "../game-library/use-game-library";

/**
 * Compact loading shown while the provider connection state is still unknown
 * (the library status fetch is in flight).
 */
function ConnectionLoading() {
  return (
    <div
      role="status"
      aria-label="Verificando conexão"
      className="flex flex-1 items-center justify-center"
    >
      <p className="text-sm text-zinc-400">Verificando conexão…</p>
    </div>
  );
}

/**
 * Home gate: the main Home is only reachable once a provider connection
 * exists. Users without one are sent to the onboarding instead, so no partial
 * Home is ever released. Renders only after the session guard; a failed
 * library fetch is treated as "no connection" (onboarding offers the retry).
 */
export function RequireProviderConnection({
  children,
  gameLibrary,
}: {
  children: ReactNode;
  gameLibrary?: GameLibraryClientLike;
}) {
  const { data, isLoading } = useGameLibrary({ gameLibrary });
  if (isLoading && !data) return <ConnectionLoading />;
  if (!data || data.connection === null) return <Navigate to="/onboarding" replace />;
  return <>{children}</>;
}

/**
 * Onboarding gate: once a provider connection exists there is nothing left to
 * set up, so the user is sent Home. Completing the Steam link naturally flips
 * this guard through the shared library query invalidation.
 */
export function RequireNoProviderConnection({
  children,
  gameLibrary,
}: {
  children: ReactNode;
  gameLibrary?: GameLibraryClientLike;
}) {
  const { data, isLoading } = useGameLibrary({ gameLibrary });
  if (isLoading && !data) return <ConnectionLoading />;
  if (data?.connection != null) return <Navigate to="/home" replace />;
  return <>{children}</>;
}
