import type { ButtonHTMLAttributes } from "react";

export interface ActionButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary";
}

const VARIANT_CLASSES: Record<NonNullable<ActionButtonProps["variant"]>, string> = {
  primary:
    "bg-indigo-600 text-white hover:bg-indigo-500 focus-visible:ring-indigo-400 disabled:bg-zinc-800 disabled:text-zinc-500",
  secondary:
    "border border-zinc-700 bg-transparent text-zinc-200 hover:bg-zinc-800 focus-visible:ring-zinc-400 disabled:text-zinc-500",
};

/**
 * Primary action button. Callers pick `type="submit"` when the button drives
 * a form; the default `type="button"` avoids accidental submissions.
 */
export function ActionButton({
  variant = "primary",
  type = "button",
  className = "",
  ...rest
}: ActionButtonProps) {
  return (
    <button
      type={type}
      className={`inline-flex items-center justify-center rounded-md px-4 py-2 text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 disabled:cursor-not-allowed ${VARIANT_CLASSES[variant]} ${className}`}
      {...rest}
    />
  );
}
