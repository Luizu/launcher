import { vi } from "vitest";

type ChangeListener = () => void;

interface MediaQueryEntry {
  matches: boolean;
  listeners: Set<ChangeListener>;
}

/**
 * jsdom provides no `window.matchMedia`, so tests fake it. Answers are kept
 * in a registry keyed by query so the fake's listeners stay reachable after
 * the render: `setMatchMediaMatches` flips a query's answer and notifies the
 * subscribed listeners, exercising the runtime reactivity of `useMediaQuery`
 * (the OS changing the setting or the viewport at runtime).
 */
const registry = new Map<string, MediaQueryEntry>();

function entryFor(query: string): MediaQueryEntry {
  let entry = registry.get(query);
  if (entry === undefined) {
    entry = { matches: false, listeners: new Set() };
    registry.set(query, entry);
  }
  return entry;
}

function mediaQueryListFor(query: string) {
  const entry = entryFor(query);
  return {
    get matches() {
      return entry.matches;
    },
    media: query,
    onchange: null,
    addEventListener: (type: string, listener: ChangeListener) => {
      if (type === "change") entry.listeners.add(listener);
    },
    removeEventListener: (type: string, listener: ChangeListener) => {
      if (type === "change") entry.listeners.delete(listener);
    },
    addListener: (listener: ChangeListener) => entry.listeners.add(listener),
    removeListener: (listener: ChangeListener) => entry.listeners.delete(listener),
    dispatchEvent: vi.fn(),
  };
}

const originalMatchMedia = window.matchMedia;

/** Answers the given media query with `matches`; all others answer false. */
export function mockMatchMedia(query: string, matches: boolean) {
  const entry = entryFor(query);
  entry.matches = matches;
  entry.listeners.clear();
  window.matchMedia = vi.fn((q: string) =>
    mediaQueryListFor(q),
  ) as unknown as typeof window.matchMedia;
}

/**
 * Flips a previously mocked query's answer and notifies its listeners, as
 * the OS would when the preference or viewport changes while the app runs.
 */
export function setMatchMediaMatches(query: string, matches: boolean) {
  const entry = registry.get(query);
  if (entry === undefined) {
    throw new Error(`setMatchMediaMatches: query was not mocked: ${query}`);
  }
  entry.matches = matches;
  entry.listeners.forEach((listener) => listener());
}

/** Restores the pre-test environment after each test. */
export function restoreMatchMedia() {
  registry.clear();
  window.matchMedia = originalMatchMedia;
}
