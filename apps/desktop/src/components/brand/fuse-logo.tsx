import type { SVGProps } from "react";

export interface FuseLogoProps {
  /** Uses the mark-only footprint intended for compact sidebars and icons. */
  compact?: boolean;
  /** Shows the Fuse Launcher wordmark next to the CUT mark. */
  showWordmark?: boolean;
  className?: string;
  /** Accessible name used when the logo is mark-only. */
  title?: string;
}
const CUT_MARK_PATH = "M13 10H52V21H25V29H47V39H25V56H13V10Z";
const CUT_SLASH_PATH = "M38 10H52L44 21H31L38 10Z";

function CutMark(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 64 64" fill="none" {...props}>
      <path d={CUT_MARK_PATH} fill="currentColor" />
      <path d={CUT_SLASH_PATH} fill="#ff925e" />
    </svg>
  );
}

/**
 * The single React source for the Fuse Launcher CUT mark and wordmark.
 * Mark-only renders as an image with a stable accessible name; the full
 * version keeps the visible wordmark as the accessible product label.
 */
export function FuseLogo({
  compact = false,
  showWordmark = !compact,
  className = "",
  title = "Fuse Launcher",
}: FuseLogoProps) {
  return (
    <span
      className={`inline-flex min-w-0 items-center gap-2 ${className}`}
      aria-label={showWordmark ? undefined : title}
    >
      <CutMark
        aria-hidden={showWordmark}
        aria-label={showWordmark ? undefined : title}
        role={showWordmark ? undefined : "img"}
        className={compact ? "h-8 w-8" : "h-9 w-9"}
      />
      {showWordmark && (
        <span className="flex min-w-0 items-baseline gap-1 whitespace-nowrap leading-none">
          <span className="text-base font-black tracking-[-0.04em] text-[#f2f6ff]">
            Fuse
          </span>
          <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#8cf5d0]">
            Launcher
          </span>
        </span>
      )}
    </span>
  );
}
