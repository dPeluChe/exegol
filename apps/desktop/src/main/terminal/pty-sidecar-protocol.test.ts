import { describe, expect, it } from "vitest";
import { holdsLease, sidecarCompatible } from "./pty-sidecar-protocol";

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

describe("sidecarCompatible", () => {
  const usable = (version: string) => sidecarCompatible(version, "1.7.1", "1.10.0");

  it("takes versions from the floor up to the app's, as numbers", () => {
    expect(usable("1.7.1")).toBe(true);
    expect(usable("1.9.0")).toBe(true);
    expect(usable("1.10.0")).toBe(true);
  });

  it("refuses one below the floor, and a newer one left by a downgrade", () => {
    expect(usable("1.7.0")).toBe(false);
    expect(usable("1.10.1")).toBe(false);
  });
});
