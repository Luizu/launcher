import { ActionButton } from "../button/action-button";
import { InlineStatus } from "./inline-status";

export interface LibraryStateError {
  message: string;
  onRetry: () => void;
}

export interface LibraryStateProps {
  /** First load in flight: render skeleton rows instead of content. */
  loading?: boolean;
  /** Connected library with no games to show. */
  empty?: boolean;
  /** Failed sides of the merge, each with its own recovery action. */
  errors?: ReadonlyArray<LibraryStateError>;
  /** Action for the empty state ("Atualizar"). */
  onRefresh?: () => void;
}

const SKELETON_ROWS = 4;

/**
 * Status area of the library page: first-load skeleton rows, error banners
 * with per-side retry (partial errors preserve the successful side), and the
 * empty state with an explicit refresh action.
 */
export function LibraryState({
  loading = false,
  empty = false,
  errors = [],
  onRefresh,
}: LibraryStateProps) {
  if (loading) {
    return (
      <div
        role="status"
        aria-label="Carregando sua biblioteca"
        className="flex flex-col gap-2"
      >
        {Array.from({ length: SKELETON_ROWS }, (_, index) => (
          <div
            key={index}
            className="h-16 animate-pulse rounded-lg border border-zinc-800 bg-zinc-900/60"
          />
        ))}
      </div>
    );
  }

  return (
    <>
      {errors.map((error, index) => (
        <InlineStatus key={index} tone="error" onRetry={error.onRetry}>
          {error.message}
        </InlineStatus>
      ))}
      {empty && (
        <div className="flex flex-col items-center gap-4 rounded-lg border border-zinc-800 bg-zinc-900/60 p-8 text-center">
          <p className="text-sm text-zinc-300">Nenhum jogo encontrado</p>
          {onRefresh && (
            <ActionButton variant="secondary" onClick={onRefresh}>
              Atualizar
            </ActionButton>
          )}
        </div>
      )}
    </>
  );
}
