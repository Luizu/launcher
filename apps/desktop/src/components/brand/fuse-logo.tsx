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
const CUT_MARK_PATH = "M14 11h37v11H26v8h21v10H26v13H14V11Z";
const CUT_SLASH_PATH = "m36 11 9 0-7 11h-9l7-11Z";

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
      role="img"
      aria-label={title}
      className={`inline-flex min-w-0 items-center gap-1.5 ${className}`}
    >
      <CutMark
        aria-hidden="true"
        className={`${compact ? "h-6 w-6" : "h-7 w-7"} shrink-0 text-[#8cf5d0]`}
      />
      {showWordmark && (
        <span className="flex min-w-0 items-baseline whitespace-nowrap leading-none">
          <span className="text-[15px] font-black uppercase tracking-[-0.08em] text-[#f2f6ff]">
            FUSE
          </span>
          <span className="sr-only text-[8px] font-extrabold uppercase tracking-[0.24em] text-[#8cf5d0]">
            LAUNCHER
          </span>
        </span>
      )}
    </span>
  );
}
