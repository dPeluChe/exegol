import { describe, expect, it } from "vitest";
import { testBuildOf, testBuildVersion } from "./test-build";

describe("testBuildVersion", () => {
  it("bumps the patch and tags the commit", () => {
    expect(testBuildVersion("0.5.20", "171da0d", false)).toBe("0.5.21-test.171da0d");
    expect(testBuildVersion("0.5.20", "171da0d", true)).toBe("0.5.21-test.171da0d.dirty");
  });

  it("keeps an all-digit sha valid semver", () => {
    expect(testBuildVersion("1.0.9", "0123456", false)).toBe("1.0.10-test.g0123456");
  });

  it("refuses a version that is not x.y.z or a sha that is not hex", () => {
    expect(testBuildVersion("0.5.20-canary.1", "171da0d", false)).toBeNull();
    expect(testBuildVersion("0.5.20", "main", false)).toBeNull();
  });
});

describe("testBuildOf", () => {
  it("reads the commit back", () => {
    expect(testBuildOf("0.5.21-test.171da0d")).toEqual({ commit: "171da0d", dirty: false });
    expect(testBuildOf("0.5.21-test.171da0d.dirty")).toEqual({ commit: "171da0d", dirty: true });
    expect(testBuildOf("1.0.10-test.g0123456")).toEqual({ commit: "0123456", dirty: false });
  });

  it("is null for releases and canaries", () => {
    expect(testBuildOf("0.5.20")).toBeNull();
    expect(testBuildOf("0.5.21-canary.20261013")).toBeNull();
  });
});
