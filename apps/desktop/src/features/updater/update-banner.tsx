import { ActionButton } from "../../components/button/action-button";
import { InlineStatus } from "../../components/status/inline-status";
import type { UpdateSnapshot } from "./updater-client";

export interface UpdateBannerProps {
  snapshot: UpdateSnapshot;
  onInstall: () => void | Promise<void>;
  onRetry: () => void | Promise<unknown>;
}

/** The only persistent update UI: available release, progress, or recovery. */
export function UpdateBanner({ snapshot, onInstall, onRetry }: UpdateBannerProps) {
  if (snapshot.status === "available") {
    return (
      <div
        role="status"
        aria-live="polite"
        className="flex flex-wrap items-center gap-3 border-b border-indigo-400/20 bg-indigo-950/30 px-6 py-3 text-sm text-indigo-100"
      >
        <div className="min-w-0 flex-1">
          <p className="font-medium">
            Atualização {snapshot.availableVersion ?? "disponível"} pronta.
          </p>
          {snapshot.releaseNotes && (
            <p className="truncate text-indigo-200/80">{snapshot.releaseNotes}</p>
          )}
        </div>
        <ActionButton onClick={() => void onInstall()}>
          Atualizar e reiniciar
        </ActionButton>
      </div>
    );
  }

  if (snapshot.status === "installing") {
    const progress = snapshot.progress ?? 0;
    return (
      <div
        role="status"
        aria-live="polite"
        className="flex items-center gap-3 border-b border-indigo-400/20 bg-indigo-950/30 px-6 py-3 text-sm text-indigo-100"
      >
        <p className="shrink-0">Baixando atualização… {progress}%</p>
        <progress
          aria-label="Progresso da atualização"
          className="h-2 min-w-0 flex-1 accent-indigo-400"
          max={100}
          value={progress}
        />
      </div>
    );
  }

  if (snapshot.status === "ready") {
    return (
      <div
        role="status"
        aria-live="polite"
        className="border-b border-emerald-400/20 bg-emerald-950/30 px-6 py-3 text-sm text-emerald-100"
      >
        Atualização instalada. Reiniciando o Launcher…
      </div>
    );
  }

  if (snapshot.status === "error") {
    return (
      <div className="px-6 pt-3">
        <InlineStatus tone="error" onRetry={() => void onRetry()}>
          {snapshot.error ?? "Não foi possível atualizar o Launcher."}
        </InlineStatus>
      </div>
    );
  }

  return null;
}
