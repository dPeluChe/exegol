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
    expect(planRelocation(null, { execPath: APPS })).toBeNull();
    expect(planRelocation({ execPath: APPS }, { execPath: APPS })).toBeNull();
    expect(planRelocation({ execPath: DMG }, { execPath: APPS })).toEqual({
      from: "/Volumes/Exegol 0.5.24/Exegol.app",
      to: "/Applications/Exegol.app",
    });
  });

  it("an AppImage is its file, whatever mount it ran from", () => {
    const a = { execPath: "/tmp/.mount_ExegoAb12/exegol", appImage: "/home/me/Exegol-1.AppImage" };
    const b = { execPath: "/tmp/.mount_ExegoZz99/exegol", appImage: a.appImage };
    expect(planRelocation(a, b)).toBeNull();
    expect(planRelocation(a, { ...b, appImage: "/home/me/Apps/Exegol-2.AppImage" })).toEqual({
      from: "/home/me/Exegol-1.AppImage",
      to: "/home/me/Apps/Exegol-2.AppImage",
    });
  });

  it("never across an AppImage and an installed copy, nor from an old mount record", () => {
    const appImage = { execPath: "/tmp/.mount_ExegoZz99/exegol", appImage: "/home/me/E.AppImage" };
    expect(planRelocation({ execPath: "/tmp/.mount_ExegoAb12/exegol" }, appImage)).toBeNull();
    expect(planRelocation(appImage, { execPath: "/opt/Exegol/exegol" })).toBeNull();
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

  it("a moved AppImage file, whole or quoted, but not a longer name", () => {
    const file = { from: "/home/me/E-1.AppImage", to: "/home/me/E-2.AppImage" };
    expect(swapRoot("/home/me/E-1.AppImage", file)).toBe("/home/me/E-2.AppImage");
    expect(swapRoot(`ELECTRON_RUN_AS_NODE=1 "/home/me/E-1.AppImage" -e 'x'`, file)).toBe(
      `ELECTRON_RUN_AS_NODE=1 "/home/me/E-2.AppImage" -e 'x'`,
    );
    expect(swapRoot("/home/me/E-1.AppImage.bak", file)).toBe("/home/me/E-1.AppImage.bak");
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
