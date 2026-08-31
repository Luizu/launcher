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
        className="flex flex-wrap items-center gap-3 rounded-2xl border border-[#79a9ff]/25 bg-[#0b1322]/95 px-4 py-3 text-sm text-[#f2f6ff] shadow-2xl"
      >
        <div className="min-w-0 flex-1">
          <p className="font-medium">
            Atualização {snapshot.availableVersion ?? "disponível"} pronta.
          </p>
          {snapshot.releaseNotes && (
            <p className="truncate text-[#9eabc0]">{snapshot.releaseNotes}</p>
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
        className="flex items-center gap-3 rounded-2xl border border-[#79a9ff]/25 bg-[#0b1322]/95 px-4 py-3 text-sm text-[#f2f6ff] shadow-2xl"
      >
        <p className="shrink-0">Baixando atualização… {progress}%</p>
        <progress
          aria-label="Progresso da atualização"
          className="h-2 min-w-0 flex-1 accent-[#8cf5d0]"
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
        className="rounded-2xl border border-[#8cf5d0]/25 bg-[#0b1322]/95 px-4 py-3 text-sm text-[#8cf5d0] shadow-2xl"
      >
        Atualização instalada. Reiniciando o Fuse Launcher…
      </div>
    );
  }

  if (snapshot.status === "error") {
    return (
      <div className="pt-3">
        <InlineStatus tone="error" onRetry={() => void onRetry()}>
          {snapshot.error ?? "Não foi possível atualizar o Fuse Launcher."}
        </InlineStatus>
      </div>
    );
  }

  return null;
}
