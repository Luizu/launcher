import { forwardRef, type ReactNode } from "react";
import { ActionButton } from "../button/action-button";

export interface InlineStatusProps {
  tone: "error" | "info";
  children: ReactNode;
  onRetry?: () => void;
  retryLabel?: string;
}

/**
 * Inline status banner. Errors are announced with `role="alert"` and are
 * focusable (the caller focuses them after a rejected submission); info and
 * loading states use `role="status"`. An optional retry action makes every
 * failure recoverable.
 */
export const InlineStatus = forwardRef<HTMLDivElement, InlineStatusProps>(
  function InlineStatus(
    { tone, children, onRetry, retryLabel = "Tentar novamente" },
    ref,
  ) {
    const isError = tone === "error";
    return (
      <div
        ref={ref}
        role={isError ? "alert" : "status"}
        tabIndex={isError ? -1 : undefined}
        className={`flex w-full items-center gap-3 rounded-md border px-3 py-2 text-sm ${
          isError
            ? "border-red-800 bg-red-950/40 text-red-200"
            : "border-zinc-700 bg-zinc-900 text-zinc-300"
        }`}
      >
        <p className="flex-1">{children}</p>
        {onRetry && (
          <ActionButton variant="secondary" onClick={onRetry}>
            {retryLabel}
          </ActionButton>
        )}
      </div>
    );
  },
);
