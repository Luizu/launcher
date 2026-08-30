import { describe, expect, it } from "vitest";
import { formatAppVersion } from "./app-version";

describe("app version", () => {
  it("formats a release version for the user-facing shell", () => {
    expect(formatAppVersion("0.4.2")).toBe("v0.4.2");
  });

  it("does not invent a version when build metadata is unavailable", () => {
    expect(formatAppVersion("desconhecida")).toBe("desconhecida");
    expect(formatAppVersion("  ")).toBe("desconhecida");
  });
});
