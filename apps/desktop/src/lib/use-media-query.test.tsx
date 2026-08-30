import { act, renderHook } from "@testing-library/react";
import {
  mockMatchMedia,
  restoreMatchMedia,
  setMatchMediaMatches,
} from "../test/match-media";
import { REDUCED_MOTION_QUERY, usePrefersReducedMotion } from "./use-media-query";

afterEach(restoreMatchMedia);

describe("useMediaQuery runtime reactivity", () => {
  it("re-renders with the new value when the matched query changes after mount", () => {
    mockMatchMedia(REDUCED_MOTION_QUERY, false);

    const { result } = renderHook(() => usePrefersReducedMotion());
    expect(result.current).toBe(false);

    // The OS preference flips while the hook is subscribed: the stored
    // change listener must fire and the hook must re-render with the new
    // value — not just on the initial mount.
    act(() => {
      setMatchMediaMatches(REDUCED_MOTION_QUERY, true);
    });
    expect(result.current).toBe(true);

    act(() => {
      setMatchMediaMatches(REDUCED_MOTION_QUERY, false);
    });
    expect(result.current).toBe(false);
  });
});
