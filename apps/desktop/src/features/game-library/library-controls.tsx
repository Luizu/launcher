import { useId } from "react";
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
  /** Number of games after search + filters, announced as "N jogos". */
  resultCount: number;
}

const SORT_OPTIONS: ReadonlyArray<{ value: LibrarySortKey; label: string }> = [
  { value: "default", label: "Padrão" },
  { value: "title", label: "Título (A-Z)" },
  { value: "activity", label: "Atividade recente" },
  { value: "playtime", label: "Playtime" },
];

function resultCountLabel(count: number): string {
  return count === 1 ? "1 jogo" : `${count} jogos`;
}

/**
 * Biblioteca toolbar: search, installed toggle, optional provider filter
 * (only with more than one provider), sort select, and a live result count.
 * Every control is a labeled form control so the whole strip is operable by
 * keyboard and announced by assistive technology; `flex-wrap` keeps it from
 * overflowing narrow windows.
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
  resultCount,
}: LibraryControlsProps) {
  const providerSelectId = useId();
  const sortSelectId = useId();

  return (
    <section
      aria-label="Busca e filtros da biblioteca"
      className="flex flex-wrap items-end gap-4 rounded-2xl border border-white/10 bg-[#0b1322]/65 p-4"
    >
      <div className="w-64 max-w-full">
        <TextField
          label="Buscar na biblioteca"
          placeholder="Buscar na biblioteca"
          value={query}
          onChange={onQueryChange}
        />
      </div>

      <label className="flex cursor-pointer items-center gap-2 pb-2.5 text-sm text-zinc-300">
        <input
          type="checkbox"
          checked={installedOnly}
          onChange={(event) => onInstalledOnlyChange(event.target.checked)}
          className="h-4 w-4 rounded border-zinc-600 bg-zinc-900 accent-[#8cf5d0]"
        />
        Somente instalados
      </label>

      {providers.length > 1 && (
        <label
          htmlFor={providerSelectId}
          className="flex flex-col gap-1.5 text-sm text-zinc-300"
        >
          Provedor
          <select
            id={providerSelectId}
            value={provider}
            onChange={(event) => onProviderChange(event.target.value)}
          className="rounded-lg border border-white/10 bg-[#111b2d] px-3 py-2 text-sm text-zinc-100 focus:border-[#8cf5d0] focus:outline-none focus:ring-1 focus:ring-[#8cf5d0]"
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

      <label
        htmlFor={sortSelectId}
        className="flex flex-col gap-1.5 text-sm text-zinc-300"
      >
        Ordenar por
        <select
          id={sortSelectId}
          value={sortKey}
          onChange={(event) => onSortKeyChange(event.target.value as LibrarySortKey)}
          className="rounded-lg border border-white/10 bg-[#111b2d] px-3 py-2 text-sm text-zinc-100 focus:border-[#8cf5d0] focus:outline-none focus:ring-1 focus:ring-[#8cf5d0]"
        >
          {SORT_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>

      <p aria-live="polite" className="pb-2.5 text-sm text-zinc-500">
        {resultCountLabel(resultCount)}
      </p>
    </section>
  );
}
