import { useId, useState } from "react";
import {
  ArrowUpDownIcon,
  FilterIcon,
} from "../../components/icons/app-icon";
import { TextField } from "../../components/input/text-field";
import { providerLabel } from "../../lib/provider-label";
import type { LibrarySortKey } from "./library-filter";

export interface LibraryControlsProps {
  query: string;
  onQueryChange: (query: string) => void;
  installedOnly: boolean;
  onInstalledOnlyChange: (installedOnly: boolean) => void;
  /** Unique providers in the merged library; the filter renders with 2+. */
  providers: readonly string[];
  /** "all" or one of `providers`; the page normalizes stale values. */
  provider: string;
  onProviderChange: (provider: string) => void;
  sortKey: LibrarySortKey;
  onSortKeyChange: (sortKey: LibrarySortKey) => void;
  /** Keeps the healthy ready state compact without removing manual sync. */
  onSync?: () => Promise<unknown>;
  /** Number of games after search + filters, announced as "N jogos". */
  resultCount: number;
}

const SORT_OPTIONS: ReadonlyArray<{ value: LibrarySortKey; label: string }> = [
  { value: "default", label: "Recentemente jogados" },
  { value: "title", label: "Título (A-Z)" },
  { value: "activity", label: "Atividade recente" },
  { value: "playtime", label: "Playtime" },
];

function resultCountLabel(count: number): string {
  return count === 1 ? "1 jogo" : `${count} jogos`;
}

/**
 * Library controls keep the approved ready state quiet: sorting remains in
 * the heading row while search, installed and provider filters live behind a
 * small disclosure. The controls stay real form elements, preserving the
 * existing keyboard and assistive-technology contract.
 */
export function LibraryControls({
  query,
  onQueryChange,
  installedOnly,
  onInstalledOnlyChange,
  providers,
  provider,
  onProviderChange,
  sortKey,
  onSortKeyChange,
  onSync,
  resultCount,
}: LibraryControlsProps) {
  const providerSelectId = useId();
  const sortSelectId = useId();
  const filterPanelId = useId();
  const [open, setOpen] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState(false);

  const handleSync = async () => {
    if (onSync === undefined || syncing) return;
    setSyncing(true);
    setSyncError(false);
    try {
      await onSync();
    } catch {
      setSyncError(true);
    } finally {
      setSyncing(false);
    }
  };

  return (
    <section
      aria-label="Busca e filtros da biblioteca"
      data-library-controls
      className="relative flex shrink-0 items-center gap-2"
    >
      <button
        type="button"
        aria-label="Filtros"
        aria-expanded={open}
        aria-controls={filterPanelId}
        onClick={() => setOpen((value) => !value)}
        className="inline-flex h-[35px] items-center gap-2 rounded-[8px] border border-[rgba(177,207,241,0.16)] px-3 text-[10px] font-bold text-[#a9b8cb] transition-colors hover:border-[#8cf5d0]/50 hover:text-[#f2f6ff] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#8cf5d0]"
      >
        <FilterIcon className="h-3.5 w-3.5" />
        Filtros
        <span aria-live="polite" className="text-[#8cf5d0]">
          {resultCountLabel(resultCount)}
        </span>
      </button>

      {open && (
        <div
          id={filterPanelId}
          className="absolute right-0 top-[45px] z-30 flex w-[min(360px,calc(100vw-40px))] flex-col gap-4 rounded-[10px] border border-[rgba(177,207,241,0.2)] bg-[#0b1322] p-4 shadow-[0_20px_45px_rgba(0,0,0,0.45)]"
        >
          <div className="w-full">
            <TextField
              label="Buscar na biblioteca"
              placeholder="Buscar na biblioteca"
              value={query}
              onChange={onQueryChange}
            />
          </div>

          <label className="flex cursor-pointer items-center gap-2 text-[12px] text-[#c8d3e4]">
            <input
              type="checkbox"
              checked={installedOnly}
              onChange={(event) => onInstalledOnlyChange(event.target.checked)}
              className="h-4 w-4 cursor-pointer rounded border-zinc-600 bg-zinc-900 accent-[#8cf5d0]"
            />
            Somente instalados
          </label>

          {providers.length > 1 && (
            <label
              htmlFor={providerSelectId}
              className="flex flex-col gap-1.5 text-[12px] text-[#c8d3e4]"
            >
              Provedor
              <select
                id={providerSelectId}
                value={provider}
                onChange={(event) => onProviderChange(event.target.value)}
                className="h-9 cursor-pointer rounded-[7px] border border-[rgba(177,207,241,0.16)] bg-[#111b2d] px-3 text-[12px] text-[#f2f6ff] focus:border-[#8cf5d0] focus:outline-none focus:ring-1 focus:ring-[#8cf5d0]"
              >
                <option value="all">Todos</option>
                {providers.map((candidate) => (
                  <option key={candidate} value={candidate}>
                    {providerLabel(candidate)}
                  </option>
                ))}
              </select>
            </label>
          )}

          {onSync !== undefined && (
            <div className="border-t border-white/10 pt-3">
              <button
                type="button"
                aria-label="Atualizar biblioteca"
                disabled={syncing}
                onClick={() => void handleSync()}
                className="inline-flex h-9 items-center justify-center rounded-[7px] bg-[#8cf5d0] px-3 text-[11px] font-bold text-[#07101b] transition-colors hover:bg-[#a5f8db] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#8cf5d0] disabled:cursor-not-allowed disabled:bg-[#111b2d] disabled:text-[#65748d]"
              >
                {syncing ? "Sincronizando…" : "Atualizar biblioteca"}
              </button>
              {syncError && (
                <p role="alert" className="mt-2 text-[11px] text-red-300">
                  Não foi possível sincronizar a biblioteca.
                </p>
              )}
            </div>
          )}
        </div>
      )}

      <label
        htmlFor={sortSelectId}
        className="order-first flex h-[35px] items-center gap-2 rounded-[8px] border border-[rgba(177,207,241,0.16)] px-3 text-[10px] text-[#a9b8cb]"
      >
        <ArrowUpDownIcon className="h-3 w-3 text-[#8da1bb]" />
        <select
          id={sortSelectId}
          aria-label="Ordenar por"
          value={sortKey}
          onChange={(event) => onSortKeyChange(event.target.value as LibrarySortKey)}
          className="max-w-[150px] cursor-pointer appearance-none bg-transparent text-[10px] text-[#a9b8cb] outline-none focus-visible:ring-2 focus-visible:ring-[#8cf5d0]"
        >
          {SORT_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
    </section>
  );
}
