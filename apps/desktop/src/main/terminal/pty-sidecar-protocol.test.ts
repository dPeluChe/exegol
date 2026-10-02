import { describe, expect, it } from "vitest";
import { holdsLease } from "./pty-sidecar-protocol";

describe("holdsLease", () => {
  const file = (token: string) => JSON.stringify({ pid: 1, token, version: "x", sock: "s" });

  it("held while the pid file names this token", () => {
    expect(holdsLease(file("mine"), "mine")).toBe(true);
  });

  it("lost when the file is gone or names a successor", () => {
    expect(holdsLease(null, "mine")).toBe(false);
    expect(holdsLease(file("next"), "mine")).toBe(false);
  });

  it("an unreadable or half-written file is no evidence", () => {
    expect(holdsLease(undefined, "mine")).toBe(true);
    expect(holdsLease('{"pid":1,"tok', "mine")).toBe(true);
  });
});
