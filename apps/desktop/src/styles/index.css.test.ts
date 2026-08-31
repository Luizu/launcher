import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Source-level assertions over the global stylesheet. jsdom cannot apply CSS,
 * so the observable contracts here are the rules themselves: no artificial
 * body/page min-width, the approved ambient loop in the stylesheet, and a
 * reduced-motion fallback that kills the loop regardless of the JS wiring.
 */
const css = readFileSync(resolve(process.cwd(), "src/styles/index.css"), "utf8");

describe("global styles", () => {
  it("does not impose an artificial min-width on the body or any element", () => {
    // No `min-width` declaration anywhere (prose in comments may mention it).
    expect(css).not.toMatch(/min-width\s*:/);
  });

  it("defines the approved ambient loop on the hero (16-20s, subtle scale, alternate)", () => {
    expect(css).toContain("@keyframes ambient-hero");
    expect(css).toMatch(/--animate-ambient|animate-ambient/);
    expect(css).toContain("18s");
    expect(css).toContain("infinite alternate");
  });

  it("kills the continuous loops under prefers-reduced-motion", () => {
    expect(css).toMatch(/prefers-reduced-motion: reduce/);
    expect(css).toMatch(/prefers-reduced-motion: reduce[\s\S]*?animation:\s*none/);
  });

  it("defines authored media transition classes and disables them for reduced motion", () => {
    expect(css).toContain("@keyframes media-in");
    expect(css).toContain("@keyframes media-out");
    expect(css).toContain(".animate-media-in");
    expect(css).toContain(".animate-media-out");
    const reducedMotionBlock = css.slice(
      css.indexOf("@media (prefers-reduced-motion: reduce)"),
    );
    expect(reducedMotionBlock).toContain(".animate-media-in");
    expect(reducedMotionBlock).toContain(".animate-media-out");
    expect(reducedMotionBlock).toContain("animation: none");
  });
});
