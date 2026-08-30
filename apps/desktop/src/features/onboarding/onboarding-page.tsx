import type { GameLibraryClientLike } from "../game-library/game-library-client";
import type { PlatformConnectionsClientLike } from "../platform-connections/platform-connections-client";
import { SteamConnectionCard } from "../platform-connections/steam-connection-card";
import {
  useSteamConnection,
  type OpenUrl,
} from "../platform-connections/use-steam-connection";

export interface OnboardingPageProps {
  /** Opens the Steam authorization URL in the external browser. */
  openUrl: OpenUrl;
  platformConnections?: PlatformConnectionsClientLike;
  gameLibrary?: GameLibraryClientLike;
}

/**
 * Provider onboarding: explains why a provider connection is required and
 * reuses the existing Steam link flow. Authorization always happens on the
 * Steam website — the launcher never asks for Steam credentials. Terminal
 * link states stay here with the card's actionable retry; Home only opens
 * once the connection exists (see `RequireProviderConnection`).
 */
export function OnboardingPage({
  openUrl,
  platformConnections,
  gameLibrary,
}: OnboardingPageProps) {
  const cardProps = useSteamConnection({
    client: platformConnections,
    gameLibrary,
    openUrl,
  });

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-8 overflow-y-auto p-6">
      <div className="flex w-full max-w-md flex-col gap-2 text-center">
        <h1 className="text-2xl font-semibold tracking-tight">
          Conecte sua conta Steam
        </h1>
        <p className="text-sm text-zinc-400">
          Para sincronizar sua biblioteca remota no launcher, conecte sua conta
          Steam. A autorização acontece no site da Steam — o launcher nunca pede
          suas credenciais.
        </p>
      </div>
      <SteamConnectionCard {...cardProps} />
    </div>
  );
}
