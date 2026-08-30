import { useSyncExternalStore } from "react";

/** Window at or below the compact breakpoint (~800×600 target). */
export const COMPACT_VIEWPORT_QUERY = "(max-width: 800px)";

/** The OS-level reduced-motion preference. */
export const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

/** matchMedia absent (jsdom, SSR) means "no". */
function matchMediaOfWindow(): typeof window.matchMedia | undefined {
  return typeof window !== "undefined" ? window.matchMedia : undefined;
}

/**
 * Reactive media-query hook built on `useSyncExternalStore`: reads the
 * current value on render and subscribes to change events, so the UI follows
 * live OS/window changes (e.g. toggling reduced motion at runtime). The
 * environment is re-checked inside `subscribe`/`getSnapshot` themselves, not
 * captured at render time, because React may run the passive-effect subscribe
 * asynchronously after the render that created it — in tests the mock can be
 * torn down between those moments. Where matchMedia is absent the value is
 * false and the subscription is a no-op.
 */
function useMediaQuery(query: string): boolean {
  const subscribe = (onChange: () => void) => {
    const matchMedia = matchMediaOfWindow();
    if (typeof matchMedia !== "function") return () => undefined;
    const media = matchMedia(query);
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  };
  const getSnapshot = () => {
    const matchMedia = matchMediaOfWindow();
    if (typeof matchMedia !== "function") return false;
    return matchMedia(query).matches;
  };
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/** True when the window is at or below the compact breakpoint. */
export function useCompactViewport(): boolean {
  return useMediaQuery(COMPACT_VIEWPORT_QUERY);
}

/** True when the OS requests reduced motion. */
export function usePrefersReducedMotion(): boolean {
  return useMediaQuery(REDUCED_MOTION_QUERY);
}
