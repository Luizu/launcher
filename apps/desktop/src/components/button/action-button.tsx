import type { ButtonHTMLAttributes } from "react";

export interface ActionButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary";
}

const VARIANT_CLASSES: Record<NonNullable<ActionButtonProps["variant"]>, string> = {
  primary:
    "bg-[#8cf5d0] text-[#07101b] hover:bg-[#a5f8db] focus-visible:ring-[#8cf5d0] disabled:bg-[#111b2d] disabled:text-[#65748d]",
  secondary:
    "border border-white/30 bg-black/20 text-[#f2f6ff] hover:bg-black/45 focus-visible:ring-[#8cf5d0] disabled:text-[#65748d]",
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
      className={`inline-flex h-[41px] items-center justify-center rounded-[8px] px-[18px] text-[11px] font-black tracking-[0.02em] transition-colors focus:outline-none focus-visible:ring-2 disabled:cursor-not-allowed ${VARIANT_CLASSES[variant]} ${className}`}
      {...rest}
    />
  );
}
