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
import { FuseLogo } from "../../components/brand/fuse-logo";
import {
  HomeIcon,
  LibraryIcon,
  SettingsIcon,
  SearchIcon,
  ChevronDownIcon,
} from "../../components/icons/app-icon";

/**
 * The hybrid shell frame around all authenticated destinations: a compact
 * sidebar (brand, Home, Biblioteca, settings placeholder) plus a topbar
 * with the current destination context and the reserved global controls
 * (busca, usuário, configurações). No permanent sync status lives here.
 * Below the compact breakpoint (~800px) the rail and the topbar shrink and
 * secondary chrome (the reserved search field) hides; the destinations and
 * the user stay reachable.
 */

const SIDEBAR_NAV_ITEMS = [
  { to: "/home", label: "Home", Icon: HomeIcon },
  { to: "/library", label: "Biblioteca", Icon: LibraryIcon },
] as const;

const DESTINATION_LABELS: Record<string, string> = {
  "/home": "Home",
  "/library": "Biblioteca",
  "/onboarding": "Conectar conta",
};

function destinationLabel(pathname: string): string {
  return DESTINATION_LABELS[pathname] ?? "Fuse";
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
      className={`flex shrink-0 flex-col border-r border-[rgba(177,207,241,0.16)] bg-[#050914] ${
        compact ? "w-[64px] items-center gap-5 px-2 py-5" : "w-[224px] gap-8 px-4 py-6"
      }`}
    >
      <FuseLogo compact={compact} className={compact ? "justify-center" : "w-full"} />
      <nav
        aria-label="Destinos"
        className={`flex flex-col gap-2 ${compact ? "items-center" : "w-full"}`}
      >
        {SIDEBAR_NAV_ITEMS.map(({ to, label, Icon }) => (
          <NavLink
            key={to}
            to={to}
            aria-label={label}
            className={({ isActive }) =>
              `flex items-center rounded-xl transition-colors focus:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#8cf5d0] ${
                compact
                  ? "h-10 w-10 justify-center"
                  : "h-11 w-full gap-3 px-3"
              } ${
                isActive
                  ? "bg-[#8cf5d0] text-[#0d1622]"
                  : "text-zinc-400 hover:bg-white/[0.06] hover:text-zinc-100"
              }`
            }
          >
            <Icon className="h-[18px] w-[18px] shrink-0" />
            {!compact && <span className="text-sm font-semibold">{label}</span>}
          </NavLink>
        ))}
      </nav>
      <div className={`mt-auto ${compact ? "flex flex-col items-center" : "w-full"}`}>
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
          className={`flex items-center rounded-xl text-zinc-600 ${
            compact ? "h-10 w-10 justify-center" : "h-11 w-full gap-3 px-3"
          }`}
        >
          <SettingsIcon className="h-[18px] w-[18px] shrink-0" />
          {!compact && <span className="text-sm font-semibold">Configurações</span>}
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
      className={`absolute inset-x-0 top-0 z-20 flex items-center gap-6 border-b border-[rgba(177,207,241,0.15)] bg-[linear-gradient(180deg,rgba(5,9,20,0.84),rgba(5,9,20,0))] ${
        compact ? "h-[58px] px-5" : "h-[72px] px-6"
      }`}
    >
      <p className="text-sm font-bold tracking-tight text-white/90">
        {destinationLabel(location.pathname)}
      </p>
      <div className="ml-auto flex min-w-0 items-center gap-3">
        {!compact && (
          <div className="relative w-52">
            <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
            <input
              type="search"
              disabled
              placeholder="Buscar jogos"
              aria-label="Buscar"
              className="h-10 w-full cursor-not-allowed rounded-lg border border-white/10 bg-black/20 pl-9 pr-3 text-sm text-zinc-400 placeholder:text-zinc-500"
            />
          </div>
        )}
        <UserMenu compact={compact} />
        <button
          type="button"
          disabled
          aria-label="Configurações"
          className="grid h-10 w-10 shrink-0 cursor-not-allowed place-items-center rounded-lg text-zinc-500"
        >
          <SettingsIcon className="h-[18px] w-[18px]" />
        </button>
      </div>
    </header>
  );
}

function UserMenu({ compact }: { compact: boolean }) {
  const { session, signOut, isSigningOut } = useSession();
  const [open, setOpen] = useState(false);
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false);
  const [diagnosticsError, setDiagnosticsError] = useState<string | null>(null);
  const [signOutError, setSignOutError] = useState<string | null>(null);
  const updater = useContext(UpdaterContext);
  const updaterStatus = updater?.snapshot.status ?? "disabled";
  const displayName = session?.user.name?.trim() || session?.user.email || "Usuário";

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
        title={displayName}
        className={`flex shrink-0 items-center rounded-full border border-[#8799b7] bg-white/10 text-xs font-bold text-zinc-100 transition-colors hover:bg-white/20 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#8cf5d0] ${
          compact
            ? "h-10 w-10 justify-center"
            : "h-10 min-w-[180px] max-w-[300px] gap-2 px-1.5 pr-3"
        }`}
      >
        <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-[#8cf5d0] text-[10px] font-black text-[#0d1622]">
          {initialsFromName(displayName)}
        </span>
        {!compact && (
          <span className="min-w-0 flex-1 truncate text-left text-xs font-bold text-zinc-100">
            {displayName}
          </span>
        )}
        {!compact && <ChevronDownIcon className="h-4 w-4 shrink-0 text-zinc-500" />}
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
      <div className="relative flex min-w-0 flex-1 flex-col overflow-hidden">
        <ShellTopbar />
        <div className="pointer-events-none absolute inset-x-4 top-[80px] z-30 [&_*]:pointer-events-auto max-[800px]:top-[66px]">
          <ShellUpdateBanner />
        </div>
        <div className="relative min-h-0 flex-1 overflow-hidden">
          <Outlet />
        </div>
      </div>
    </div>
  );
}
