import { useEffect, useRef, useState } from "react";
import type { UpdateStatus } from "../updater/updater-client";

export interface DiagnosticsPanelProps {
  version: string;
  environment: "development" | "production";
  apiOrigin: string;
  updaterStatus: UpdateStatus;
  sentryConfigured: boolean;
  onClose: () => void;
  onOpenLogs: () => Promise<void>;
  onCheckUpdates: () => Promise<unknown>;
}

const UPDATE_STATUS_LABELS: Record<UpdateStatus, string> = {
  disabled: "Desativado",
  idle: "Aguardando",
  checking: "Verificando",
  "up-to-date": "Atualizado",
  available: "Disponível",
  installing: "Instalando",
  ready: "Pronto",
  error: "Erro",
};

/** Safe, progressive-disclosure runtime diagnostics for support. */
export function DiagnosticsPanel({
  version,
  environment,
  apiOrigin,
  updaterStatus,
  sentryConfigured,
  onClose,
  onOpenLogs,
  onCheckUpdates,
}: DiagnosticsPanelProps) {
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const [logsError, setLogsError] = useState<string | null>(null);
  const [updateCheckError, setUpdateCheckError] = useState<string | null>(null);

  useEffect(() => {
    closeButtonRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  async function handleOpenLogs() {
    setLogsError(null);
    try {
      await onOpenLogs();
    } catch {
      setLogsError("Não foi possível abrir a pasta de logs.");
    }
  }

  async function handleCheckUpdates() {
    setUpdateCheckError(null);
    try {
      await onCheckUpdates();
    } catch {
      setUpdateCheckError("Não foi possível verificar atualizações.");
    }
  }

  return (
    <div className="fixed inset-0 z-30 grid place-items-center bg-black/60 px-4 py-8">
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="diagnostics-title"
        className="w-full max-w-md rounded-2xl border border-zinc-700 bg-[#0b1322] p-5 text-zinc-100 shadow-2xl"
      >
        <div className="flex items-start gap-4">
          <div className="min-w-0 flex-1">
            <p className="text-xs uppercase tracking-[0.18em] text-zinc-500">Suporte</p>
            <h2 id="diagnostics-title" className="mt-1 text-lg font-semibold">
              Diagnóstico
            </h2>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            aria-label="Fechar diagnóstico"
            onClick={onClose}
            className="rounded-lg px-2 py-1 text-xl leading-none text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#8cf5d0]"
          >
            ×
          </button>
        </div>

        <dl className="mt-5 grid grid-cols-[auto_1fr] gap-x-5 gap-y-3 text-sm">
          <dt className="text-zinc-500">Versão</dt>
          <dd className="truncate text-right text-zinc-200">{version}</dd>
          <dt className="text-zinc-500">Ambiente</dt>
          <dd className="text-right text-zinc-200">
            {environment === "production" ? "Produção" : "Desenvolvimento"}
          </dd>
          <dt className="text-zinc-500">API</dt>
          <dd className="truncate text-right text-zinc-200">{apiOrigin}</dd>
          <dt className="text-zinc-500">Atualizações</dt>
          <dd className="text-right text-zinc-200">{UPDATE_STATUS_LABELS[updaterStatus]}</dd>
          <dt className="text-zinc-500">Sentry</dt>
          <dd className="text-right text-zinc-200">
            {sentryConfigured ? "Configurado" : "Desativado"}
          </dd>
        </dl>

        {logsError && (
          <p role="alert" className="mt-4 text-sm text-red-300">
            {logsError}
          </p>
        )}
        {updateCheckError && (
          <p role="alert" className="mt-4 text-sm text-red-300">
            {updateCheckError}
          </p>
        )}
        <div className="mt-6 flex flex-col gap-2">
          <button
            type="button"
            disabled={updaterStatus === "checking" || updaterStatus === "installing"}
            onClick={() => void handleCheckUpdates()}
            className="w-full rounded-lg border border-indigo-400/40 px-3 py-2 text-sm font-medium text-indigo-100 transition hover:bg-indigo-950/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#8cf5d0] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {updaterStatus === "checking" ? "Verificando…" : "Verificar atualizações"}
          </button>
          <button
            type="button"
            onClick={() => void handleOpenLogs()}
            className="w-full rounded-lg border border-zinc-700 px-3 py-2 text-sm font-medium text-zinc-200 transition hover:bg-zinc-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#8cf5d0]"
          >
            Abrir pasta de logs
          </button>
        </div>
      </section>
    </div>
  );
}
