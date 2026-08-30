import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ErrorBoundary } from "@sentry/react";
import { attachConsole } from "@tauri-apps/plugin-log";
import { AppProviders } from "./app/providers";
import {
  initializeRendererSentry,
  logRendererError,
  registerRendererErrorHandlers,
} from "./lib/observability/sentry";
import "./styles/index.css";

initializeRendererSentry();
registerRendererErrorHandlers();

// Bridge the WebView console and the native log pipeline (which prints to
// the terminal through the Rust plugin's stdout target). Only reachable
// inside the Tauri WebView: in plain-browser dev (`bun dev:web`) and under
// Vitest there is no `plugin:log` command to talk to, so the bridge is
// skipped entirely and boot never depends on it.
if (typeof window !== "undefined" && "__TAURI_INTERNALS__" in window) {
  try {
    void attachConsole().catch(() => {
      // Best-effort: a failed bridge must never break the app boot.
    });
  } catch {
    // Same for the synchronous failure path.
  }
}

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("Root element #root was not found");
}

createRoot(rootElement).render(
  <ErrorBoundary
    onError={(error) => logRendererError(error, { event: "render_error" })}
    fallback={
      <main className="flex min-h-screen items-center justify-center bg-[#090d14] px-6 text-center text-white">
        <section className="max-w-md space-y-4">
          <h1 className="text-xl font-semibold">O launcher encontrou um problema</h1>
          <p className="text-sm text-white/65">
            Tente recarregar o aplicativo. Se o problema continuar, abra a pasta de logs pelo menu do usuário.
          </p>
          <button
            className="rounded-lg bg-white px-4 py-2 text-sm font-medium text-slate-950 transition hover:bg-white/85"
            onClick={() => window.location.reload()}
            type="button"
          >
            Recarregar
          </button>
        </section>
      </main>
    }
  >
    <StrictMode>
      <AppProviders />
    </StrictMode>
  </ErrorBoundary>,
);
