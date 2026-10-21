import { describe, expect, it } from "vitest";
import {
  axeCandidates,
  looksLikeAxe,
  parseScreenSize,
  parseSimctlDevices,
  runtimeLabel,
} from "./parse";

const IPHONE = "7CE18B87-35AB-4E2B-A352-DD075A8219C4";
const IPAD = "5416880F-6C85-48B7-8C63-A9D30E944798";
const WATCH = "0A1B2C3D-0000-4000-8000-000000000001";
const OLD = "0A1B2C3D-0000-4000-8000-000000000002";

const SIMCTL = JSON.stringify({
  devices: {
    "com.apple.CoreSimulator.SimRuntime.watchOS-26-0": [
      { udid: WATCH, name: "Apple Watch Ultra 3", state: "Shutdown", isAvailable: true },
    ],
    "com.apple.CoreSimulator.SimRuntime.iOS-18-5": [
      { udid: OLD, name: "iPhone 16", state: "Shutdown", isAvailable: true },
    ],
    "com.apple.CoreSimulator.SimRuntime.iOS-26-3": [
      { udid: IPAD, name: "iPad Air 11-inch (M3)", state: "Shutdown", isAvailable: true },
      { udid: IPHONE, name: "iPhone 17 Pro", state: "Booted", isAvailable: true },
      { udid: "not-a-udid", name: "Broken", state: "Shutdown", isAvailable: true },
      { udid: OLD.replace("2", "3"), name: "Gone", state: "Shutdown", isAvailable: false },
    ],
  },
});

describe("parseSimctlDevices", () => {
  it("lists iOS first, newest runtime first, then by name", () => {
    expect(parseSimctlDevices(SIMCTL)).toEqual([
      { udid: IPAD, name: "iPad Air 11-inch (M3)", runtime: "iOS 26.3", state: "Shutdown" },
      { udid: IPHONE, name: "iPhone 17 Pro", runtime: "iOS 26.3", state: "Booted" },
      { udid: OLD, name: "iPhone 16", runtime: "iOS 18.5", state: "Shutdown" },
      { udid: WATCH, name: "Apple Watch Ultra 3", runtime: "watchOS 26.0", state: "Shutdown" },
    ]);
  });

  it("drops unavailable devices and bad udids, and survives bad JSON", () => {
    const names = parseSimctlDevices(SIMCTL).map((d) => d.name);
    expect(names).not.toContain("Broken");
    expect(names).not.toContain("Gone");
    expect(parseSimctlDevices("not json")).toEqual([]);
    expect(parseSimctlDevices("{}")).toEqual([]);
  });
});

describe("runtimeLabel", () => {
  it("turns a runtime identifier into its name", () => {
    expect(runtimeLabel("com.apple.CoreSimulator.SimRuntime.iOS-26-3")).toBe("iOS 26.3");
    expect(runtimeLabel("com.apple.CoreSimulator.SimRuntime.xrOS-2-0")).toBe("xrOS 2.0");
    expect(runtimeLabel("something")).toBe("something");
  });
});

describe("parseScreenSize", () => {
  it("reads the root frame of describe-ui in points", () => {
    const tree = JSON.stringify([
      { type: "Application", frame: { x: 0, y: 0, width: 402, height: 874 }, children: [] },
    ]);
    expect(parseScreenSize(tree)).toEqual({ width: 402, height: 874 });
  });

  it("is null for an empty or broken tree", () => {
    expect(parseScreenSize("[]")).toBeNull();
    expect(parseScreenSize("")).toBeNull();
    expect(parseScreenSize(JSON.stringify([{ frame: { width: 0, height: 10 } }]))).toBeNull();
  });
});

describe("AXe detection", () => {
  it("tries the PATH hit, then Homebrew, without repeats", () => {
    expect(axeCandidates("/Users/me/bin/axe")).toEqual([
      "/Users/me/bin/axe",
      "/opt/homebrew/bin/axe",
      "/usr/local/bin/axe",
    ]);
    expect(axeCandidates("/opt/homebrew/bin/axe")).toEqual([
      "/opt/homebrew/bin/axe",
      "/usr/local/bin/axe",
    ]);
    expect(axeCandidates(null)).toHaveLength(2);
  });

  it("accepts AXe's help and refuses another tool named axe", () => {
    const axeHelp =
      "OVERVIEW: A utility to interact with iOS Simulators\n  stream-video  Stream simulator frames";
    expect(looksLikeAxe(axeHelp)).toBe(true);
    expect(looksLikeAxe("Usage: axe [options] [url...]\n  --rules  accessibility rules")).toBe(
      false,
    );
    expect(looksLikeAxe("")).toBe(false);
  });
});
