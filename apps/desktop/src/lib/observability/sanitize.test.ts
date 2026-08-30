import { describe, expect, it } from "vitest";
import { sanitizeText, sanitizeValue } from "./sanitize";

describe("renderer observability sanitization", () => {
  it("redacts bearer tokens and credentials in text", () => {
    expect(sanitizeText("Authorization: Bearer abc123 password=secret-value"))
      .toContain("[REDACTED]");
    expect(sanitizeText("Authorization: Bearer abc123")).not.toContain("abc123");
  });

  it("keeps safe metadata and redacts sensitive keys", () => {
    expect(
      sanitizeValue({ status: 503, route: "/api/library", cookie: "session=secret" }),
    ).toEqual({ status: 503, route: "/api/library", cookie: "[REDACTED]" });
  });

  it("redacts personal POSIX and Windows paths", () => {
    expect(sanitizeText("/Users/alice/AppData/log.txt")).toContain("[user-path]");
    expect(sanitizeText("C:\\Users\\alice\\AppData\\log.txt")).toContain("[user-path]");
  });

  it("drops arbitrary object fields and bounds long strings", () => {
    const result = sanitizeValue({
      event: "renderer_error",
      requestId: "req-123",
      secretNote: "private-value",
      arbitrary: "must not leave the process",
      message: "x".repeat(10_000),
    });

    expect(result).toMatchObject({
      event: "renderer_error",
      requestId: "req-123",
      secretNote: "[REDACTED]",
    });
    expect(result).not.toHaveProperty("arbitrary");
    expect((result as { message: string }).message.length).toBeLessThanOrEqual(2_000);
  });
});
