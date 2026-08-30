import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "react-router-dom";
import { router } from "./router";
import { AuthProvider } from "../features/auth/auth-context";
import { ApiClient } from "../lib/api-client";
import { AuthClient } from "../lib/auth-client";
import { TauriClient } from "../lib/tauri-client";
import { UpdaterProvider } from "../features/updater/updater-context";

function isUnauthorized(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "status" in error &&
    error.status === 401
  );
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (failureCount, error) => {
        if (isUnauthorized(error)) return false;
        return failureCount < 2;
      },
      staleTime: 5 * 60 * 1000,
    },
  },
});

/**
 * Shared client seams: features consume these instead of calling `fetch`
 * or `invoke` directly. The API base URL comes from `VITE_API_URL`.
 */
export const apiClient = new ApiClient();
export const authClient = new AuthClient(apiClient);
export const tauriClient = new TauriClient();

export function AppProviders() {
  return (
    <QueryClientProvider client={queryClient}>
      <UpdaterProvider>
        <AuthProvider client={authClient}>
          <RouterProvider router={router} />
        </AuthProvider>
      </UpdaterProvider>
    </QueryClientProvider>
  );
}
