import type { ReactNode, SVGProps } from "react";

export type AppIconProps = SVGProps<SVGSVGElement>;

function IconBase({ children, ...props }: AppIconProps & { children: ReactNode }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      {children}
    </svg>
  );
}

export function HomeIcon(props: AppIconProps) {
  return (
    <IconBase {...props}>
      <path d="m3.5 10.5 8.5-7 8.5 7" />
      <path d="M5.5 9.5v10h13v-10M9.5 19.5v-5h5v5" />
    </IconBase>
  );
}

export function LibraryIcon(props: AppIconProps) {
  return (
    <IconBase {...props}>
      <rect x="4" y="4" width="16" height="16" rx="2.5" />
      <path d="M8 4v16M8 9h12M8 15h12" />
    </IconBase>
  );
}

export function SettingsIcon(props: AppIconProps) {
  return (
    <IconBase {...props}>
      <path d="M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7Z" />
      <path d="m19.4 15 .1.1a1.8 1.8 0 0 1-2.5 2.5l-.1-.1a1.8 1.8 0 0 0-3.1 1.3v.2a1.8 1.8 0 0 1-3.6 0v-.2a1.8 1.8 0 0 0-3.1-1.3l-.1.1a1.8 1.8 0 0 1-2.5-2.5l.1-.1a1.8 1.8 0 0 0-1.3-3.1h-.2a1.8 1.8 0 0 1 0-3.6h.2a1.8 1.8 0 0 0 1.3-3.1l-.1-.1A1.8 1.8 0 0 1 7 2.6l.1.1a1.8 1.8 0 0 0 3.1-1.3v-.2a1.8 1.8 0 0 1 3.6 0v.2a1.8 1.8 0 0 0 3.1 1.3l.1-.1a1.8 1.8 0 0 1 2.5 2.5l-.1.1a1.8 1.8 0 0 0 1.3 3.1h.2a1.8 1.8 0 0 1 0 3.6h-.2a1.8 1.8 0 0 0-1.3 3.1Z" />
    </IconBase>
  );
}

export function SearchIcon(props: AppIconProps) {
  return (
    <IconBase {...props}>
      <circle cx="10.8" cy="10.8" r="5.8" />
      <path d="m15.2 15.2 5 5" />
    </IconBase>
  );
}

export function ChevronDownIcon(props: AppIconProps) {
  return (
    <IconBase {...props}>
      <path d="m6.5 9 5.5 5.5L17.5 9" />
    </IconBase>
  );
}

export function PlayIcon(props: AppIconProps) {
  return (
    <IconBase {...props}>
      <path d="m8.5 5.5 9 6.5-9 6.5v-13Z" fill="currentColor" stroke="none" />
    </IconBase>
  );
}

export function ArrowLeftIcon(props: AppIconProps) {
  return (
    <IconBase {...props}>
      <path d="M19 12H5M11 6l-6 6 6 6" />
    </IconBase>
  );
}
