import { describe, expect, it } from "vitest";
import {
  bundleRoot,
  isTransientLocation,
  planRelocation,
  shouldOfferMove,
  swapRoot,
} from "./app-location";

const DMG = "/Volumes/Exegol 0.5.24/Exegol.app/Contents/MacOS/Exegol";
const APPS = "/Applications/Exegol.app/Contents/MacOS/Exegol";

describe("bundleRoot", () => {
  it("is the .app on macOS, else the executable's folder", () => {
    expect(bundleRoot(APPS)).toBe("/Applications/Exegol.app");
    expect(bundleRoot("/tmp/.mount_ExegoAb12/exegol")).toBe("/tmp/.mount_ExegoAb12");
    expect(bundleRoot("/opt/Exegol/exegol")).toBe("/opt/Exegol");
  });
});

describe("isTransientLocation", () => {
  it("flags a DMG volume and a translocated copy", () => {
    expect(isTransientLocation(DMG)).toBe(true);
    expect(
      isTransientLocation(
        "/private/var/folders/x/AppTranslocation/ABC/d/Exegol.app/Contents/MacOS/Exegol",
      ),
    ).toBe(true);
    expect(isTransientLocation(APPS)).toBe(false);
  });
});

describe("planRelocation", () => {
  it("only when a recorded launch ran from another root", () => {
    expect(planRelocation(null, APPS)).toBeNull();
    expect(planRelocation(APPS, APPS)).toBeNull();
    expect(planRelocation(DMG, APPS)).toEqual({
      from: "/Volumes/Exegol 0.5.24/Exegol.app",
      to: "/Applications/Exegol.app",
    });
  });
});

describe("swapRoot", () => {
  const move = { from: "/Volumes/E/Exegol.app", to: "/Applications/Exegol.app" };
  it("moves every path under the old root, leaves the rest", () => {
    const entry = {
      command: "/Volumes/E/Exegol.app/Contents/MacOS/Exegol",
      args: ["/Volumes/E/Exegol.app/Contents/Resources/app.asar.unpacked/shim.js"],
      env: { ELECTRON_RUN_AS_NODE: "1", OTHER: "/Volumes/E/Exegol.app2/x" },
      enabled: true,
    };
    expect(swapRoot(entry, move)).toEqual({
      command: "/Applications/Exegol.app/Contents/MacOS/Exegol",
      args: ["/Applications/Exegol.app/Contents/Resources/app.asar.unpacked/shim.js"],
      env: { ELECTRON_RUN_AS_NODE: "1", OTHER: "/Volumes/E/Exegol.app2/x" },
      enabled: true,
    });
  });

  it("inside a command line too", () => {
    const cmd =
      'ELECTRON_RUN_AS_NODE=1 "/Volumes/E/Exegol.app/Contents/MacOS/Exegol" "/Volumes/E/Exegol.app/g.js"';
    expect(swapRoot(cmd, move)).toBe(
      'ELECTRON_RUN_AS_NODE=1 "/Applications/Exegol.app/Contents/MacOS/Exegol" "/Applications/Exegol.app/g.js"',
    );
  });
});

describe("shouldOfferMove", () => {
  const base = { platform: "darwin", packaged: true, execPath: DMG, inApplications: false };
  it("a packaged macOS app off a DMG, nothing else", () => {
    expect(shouldOfferMove(base)).toBe(true);
    expect(shouldOfferMove({ ...base, packaged: false })).toBe(false);
    expect(shouldOfferMove({ ...base, platform: "linux" })).toBe(false);
    expect(shouldOfferMove({ ...base, inApplications: true })).toBe(false);
    expect(
      shouldOfferMove({ ...base, execPath: "/Users/me/Desktop/Exegol.app/Contents/MacOS/Exegol" }),
    ).toBe(false);
  });
});
