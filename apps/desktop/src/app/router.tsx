import { createHashRouter, Navigate, type RouteObject } from "react-router-dom";
import { openUrl } from "@tauri-apps/plugin-opener";
import { App } from "./App";
import { authRoutes, RequireSession } from "../features/auth/auth.routes";
import { GamePage } from "../features/game-page/game-page";
import { SyncCycle } from "../features/game-library/sync-cycle/use-sync-cycle";
import { LibraryPage } from "../features/game-library/library-page";
import { HomePage } from "../features/home/home-page";
import { OnboardingPage } from "../features/onboarding/onboarding-page";
import {
  RequireNoProviderConnection,
  RequireProviderConnection,
} from "../features/onboarding/provider-guards";
import { AppShell } from "../features/shell/app-shell";

/**
 * The root redirects to Home; the authenticated area runs inside the hybrid
 * shell (sidebar + topbar) and is gated first by the session, then by the
 * provider connection: `/home` needs a connection (otherwise onboarding),
 * `/onboarding` needs the setup (otherwise Home), and `/library` stays
 * directly accessible. `/auth` keeps the guest guard.
 */
export const routes: RouteObject[] = [
  {
    path: "/",
    element: <App />,
    children: [
      { index: true, element: <Navigate to="/home" replace /> },
      ...authRoutes,
      {
        element: (
          <RequireSession>
            <SyncCycle>
              <AppShell />
            </SyncCycle>
          </RequireSession>
        ),
        children: [
          {
            path: "home",
            element: (
              <RequireProviderConnection>
                <HomePage />
              </RequireProviderConnection>
            ),
          },
          {
            path: "onboarding",
            element: (
              <RequireNoProviderConnection>
                <OnboardingPage openUrl={openUrl} />
              </RequireNoProviderConnection>
            ),
          },
          {
            path: "library",
            element: <LibraryPage openUrl={openUrl} />,
          },
          {
            path: "games/:identityId",
            element: <GamePage />,
          },
        ],
      },
    ],
  },
];

/**
 * Hash router: in the packaged Tauri WebView (`tauri://localhost`) the
 * History API has no server to serve sub-routes, so hash routing survives
 * reloads; dev behavior is identical.
 */
export const router = createHashRouter(routes);
