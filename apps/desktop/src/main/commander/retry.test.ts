import { describe, expect, it } from "vitest";
import { retryableError, takeRetry } from "./retry";

describe("retryableError", () => {
  it("takes the errors Claude Code writes when the API or the network failed", () => {
    for (const text of [
      "API Error: Can't reach the API server — check your internet or DNS (ENOTFOUND)",
      "API Error: Your computer went to sleep mid-response. The response above may be incomplete.",
      "API Error: Connection lost mid-response. The response above may be incomplete.",
      "API Error: 529 Overloaded. This is a server-side issue, usually temporary.",
      "API Error: 500 Internal server error. This is a server-side issue.",
      "API Error: The response stopped arriving. The response above may be incomplete.",
      "stream error: stream disconnected before completion",
    ]) {
      expect(retryableError(text), text).toBe(true);
    }
  });

  it("leaves what only the person can fix, and ordinary answers", () => {
    for (const text of [
      "Login expired · Please run /login",
      "Please run /login · API Error: 401 OAuth access token has been revoked",
      "API Error: Opus 5's safeguards flagged this message",
      "The fix is in: the API Error: 529 Overloaded case now retries after a timeout.",
      "API Error: 401 OAuth access token has been revoked",
      "",
    ]) {
      expect(retryableError(text), text).toBe(false);
    }
  });
});

describe("takeRetry", () => {
  it("allows three an hour per session", () => {
    const at = 1_000_000;
    expect([0, 1, 2, 3].map((i) => takeRetry("a", at + i))).toEqual([true, true, true, false]);
    expect(takeRetry("b", at)).toBe(true);
    expect(takeRetry("a", at + 61 * 60_000)).toBe(true);
  });
});
