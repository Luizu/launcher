import { useContext, useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { diagnosticsClient } from "../diagnostics/diagnostics-client";
import { toHumanReadableAuthError } from "../auth/auth-context";
import { useSession } from "../auth/use-session";
import { useLocalLibraryWatcher } from "../local-library/use-local-library-watcher";
import { useCompactViewport } from "../../lib/use-media-query";
import { DEFAULT_API_BASE_URL } from "../../lib/api-config";
import { APP_VERSION, formatAppVersion } from "../../lib/app-version";
import { DiagnosticsPanel } from "../diagnostics/diagnostics-panel";
import { UpdateBanner } from "../updater/update-banner";
import { UpdaterContext } from "../updater/updater-context";

/**
 * The hybrid shell frame around all authenticated destinations: a compact
 * sidebar rail (brand, Home, Biblioteca, settings placeholder) plus a topbar
 * with the current destination context and the reserved global controls
 * (busca, usuário, configurações). No permanent sync status lives here.
 * Below the compact breakpoint (~800px) the rail and the topbar shrink and
 * secondary chrome (the reserved search field) hides; the destinations and
 * the user stay reachable.
 */

const SIDEBAR_NAV_ITEMS = [
  { to: "/home", label: "Home", icon: "⌂" },
  { to: "/library", label: "Biblioteca", icon: "▦" },
] as const;

const DESTINATION_LABELS: Record<string, string> = {
  "/home": "Home",
  "/library": "Biblioteca",
  "/onboarding": "Conectar conta",
};

function destinationLabel(pathname: string): string {
  return DESTINATION_LABELS[pathname] ?? "Launcher";
}

function initialsFromName(name: string | null | undefined): string {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) {
    return parts[0].slice(0, 2).toUpperCase();
  }
  return parts
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
}

export function ShellSidebar() {
  const compact = useCompactViewport();
  const displayVersion = formatAppVersion(APP_VERSION);

  return (
    <aside
      aria-label="Menu principal"
      className={`flex shrink-0 flex-col items-center border-r border-[rgba(177,207,241,0.16)] bg-[#050914] ${
        compact ? "w-[60px] gap-5 py-5" : "w-[78px] gap-8 py-6"
      }`}
    >
      <span
        aria-hidden="true"
        className={`font-black text-[#8cf5d0] ${compact ? "text-base" : "text-xl"}`}
      >
        ✦
      </span>
      <nav aria-label="Destinos" className="flex flex-col items-center gap-3">
        {SIDEBAR_NAV_ITEMS.map(({ to, label, icon }) => (
          <NavLink
            key={to}
            to={to}
            aria-label={label}
            className={({ isActive }) =>
              `grid place-items-center rounded-xl transition-colors focus:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#8cf5d0] ${
                compact ? "h-[34px] w-[34px] text-base" : "h-10 w-10 text-lg"
              } ${
                isActive
                  ? "bg-[#8cf5d0] text-[#0d1622]"
                  : "text-zinc-400 hover:bg-zinc-800/60 hover:text-zinc-200"
              }`
            }
          >
            <span aria-hidden="true">{icon}</span>
          </NavLink>
        ))}
      </nav>
      <div className="mt-auto">
        <span
          aria-label={`Versão da aplicação: ${displayVersion}`}
          title={`Versão da aplicação: ${displayVersion}`}
          className={`mb-3 block font-mono text-[10px] text-zinc-500 ${
            compact ? "[writing-mode:vertical-rl]" : ""
          }`}
        >
          {displayVersion}
        </span>
        <button
          type="button"
          disabled
          aria-label="Configurações"
          className={`grid place-items-center rounded-xl text-zinc-600 ${
            compact ? "h-[34px] w-[34px] text-base" : "h-10 w-10 text-lg"
          }`}
        >
          <span aria-hidden="true">⚙</span>
        </button>
      </div>
    </aside>
  );
}

export function ShellTopbar() {
  const location = useLocation();
  const compact = useCompactViewport();

  return (
    <header
      className={`flex shrink-0 items-center gap-6 border-b border-[rgba(177,207,241,0.15)] bg-[rgba(4,9,18,0.35)] ${
        compact ? "h-[58px] px-5" : "h-[72px] px-6"
      }`}
    >
      <p className="text-sm font-bold tracking-tight text-white">
        {destinationLabel(location.pathname)}
      </p>
      <div className="ml-auto flex items-center gap-4">
        {!compact && (
          <input
            type="search"
            disabled
            placeholder="Buscar"
            aria-label="Buscar"
            className="h-9 w-52 cursor-not-allowed rounded-lg border border-zinc-700/60 bg-black/20 px-3 text-sm text-zinc-400 placeholder:text-zinc-500"
          />
        )}
        <UserMenu />
        <button
          type="button"
          disabled
          aria-label="Configurações"
          className="grid h-9 w-9 cursor-not-allowed place-items-center rounded-lg text-lg text-zinc-500"
        >
          <span aria-hidden="true">⚙</span>
        </button>
      </div>
    </header>
  );
}

function UserMenu() {
  const { session, signOut, isSigningOut } = useSession();
  const [open, setOpen] = useState(false);
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false);
  const [diagnosticsError, setDiagnosticsError] = useState<string | null>(null);
  const [signOutError, setSignOutError] = useState<string | null>(null);
  const updater = useContext(UpdaterContext);
  const updaterStatus = updater?.snapshot.status ?? "disabled";

  async function handleOpenLogs() {
    setDiagnosticsError(null);
    try {
      await diagnosticsClient.openLogs();
    } catch {
      setDiagnosticsError(
        "Não foi possível abrir os logs. Tente novamente no aplicativo desktop.",
      );
    }
  }

  async function handleSignOut() {
    setSignOutError(null);
    try {
      await signOut();
      setOpen(false);
    } catch (error) {
      setSignOutError(toHumanReadableAuthError(error));
    }
  }

  return (
    <div className="relative">
      <button
        type="button"
        aria-label="Usuário"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        className="grid h-9 w-9 place-items-center rounded-full border border-[#8799b7] bg-white/10 text-xs font-bold text-zinc-100 transition-colors hover:bg-white/20 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#8cf5d0]"
      >
        {initialsFromName(session?.user.name)}
      </button>
      {open && (
        <div
          role="menu"
          aria-label="Menu do usuário"
          className="absolute right-0 top-12 z-20 flex w-64 flex-col gap-2 rounded-xl border border-zinc-700 bg-[#0b1322] p-3 shadow-2xl"
        >
          <div className="border-b border-zinc-800 px-2 pb-2">
            <p className="text-xs uppercase tracking-wide text-zinc-500">Conta</p>
            <p className="truncate text-sm text-zinc-200">{session?.user.email}</p>
          </div>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              setDiagnosticsOpen(true);
            }}
            className="rounded-lg px-2 py-2 text-left text-sm text-zinc-300 hover:bg-zinc-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#8cf5d0]"
          >
            Diagnóstico
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => void handleOpenLogs()}
            className="rounded-lg px-2 py-2 text-left text-sm text-zinc-300 hover:bg-zinc-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#8cf5d0]"
          >
            Abrir logs
          </button>
          <button
            type="button"
            role="menuitem"
            disabled={isSigningOut}
            onClick={() => void handleSignOut()}
            className="rounded-lg px-2 py-2 text-left text-sm text-zinc-300 hover:bg-zinc-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#8cf5d0] disabled:cursor-not-allowed disabled:text-zinc-500"
          >
            {isSigningOut ? "Saindo…" : "Sair"}
          </button>
          {diagnosticsError && (
            <p role="alert" className="px-2 text-xs text-red-300">
              {diagnosticsError}
            </p>
          )}
          {signOutError && (
            <p role="alert" className="px-2 text-xs text-red-300">
              {signOutError}
            </p>
          )}
        </div>
      )}
      {diagnosticsOpen && (
        <DiagnosticsPanel
          version={APP_VERSION}
          environment={import.meta.env.PROD ? "production" : "development"}
          apiOrigin={safeApiOrigin(import.meta.env.VITE_API_URL ?? DEFAULT_API_BASE_URL)}
          updaterStatus={updaterStatus}
          sentryConfigured={Boolean(import.meta.env.VITE_SENTRY_DSN?.trim())}
          onClose={() => setDiagnosticsOpen(false)}
          onOpenLogs={() => diagnosticsClient.openLogs()}
          onCheckUpdates={() => updater?.checkForUpdates() ?? Promise.resolve()}
        />
      )}
    </div>
  );
}

function safeApiOrigin(value: string): string {
  try {
    return new URL(value).origin;
  } catch {
    return "não configurada";
  }
}

function ShellUpdateBanner() {
  const updater = useContext(UpdaterContext);
  if (updater === null) return null;

  return (
    <UpdateBanner
      snapshot={updater.snapshot}
      onInstall={updater.installUpdate}
      onRetry={updater.checkForUpdates}
    />
  );
}

export function AppShell() {
  // The Steam watcher keeps the local library cache fresh across installs,
  // removals, and library changes. Outside the Tauri runtime it is a no-op.
  useLocalLibraryWatcher();
  return (
    <div className="flex h-full overflow-hidden bg-[#050914]">
      <ShellSidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <ShellTopbar />
        <ShellUpdateBanner />
        <Outlet />
      </div>
    </div>
  );
}
