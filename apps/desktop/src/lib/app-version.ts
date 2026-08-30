const UNKNOWN_VERSION = "desconhecida";

/** Version injected by Vite from the root release-please package. */
export const APP_VERSION =
  import.meta.env.VITE_APP_VERSION?.trim() || UNKNOWN_VERSION;

export function formatAppVersion(version: string = APP_VERSION): string {
  const normalized = version.trim();
  return normalized && normalized !== UNKNOWN_VERSION
    ? `v${normalized}`
    : UNKNOWN_VERSION;
}
