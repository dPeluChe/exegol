import { describe, expect, it, vi } from "vitest";
import { MAX_PENDING_PER_PAGE } from "./pending-store";
import {
  addPendingPermission,
  decideSitePermission,
  denyPermissionsOf,
  findPendingPermission,
  forgetOnceUnless,
  grantedOnceOn,
  grantOnce,
  isAllowed,
  pendingPermissionsOf,
  permissionOrigin,
  permissionPrompt,
  routePermission,
  type SitePermissionContext,
  settlePermission,
} from "./site-permissions";

const ctx: SitePermissionContext = {
  agentActing: false,
  saved: {},
  grantedOnce: new Set(),
  pendingOnPage: () => 0,
};

describe("routePermission", () => {
  it("leaves the clipboard to its own policy", () => {
    expect(routePermission("clipboard-read", [])).toBeNull();
    expect(routePermission("clipboard-sanitized-write", [])).toBeNull();
  });

  it("asks for location, notifications, MIDI and external apps", () => {
    expect(routePermission("geolocation", [])).toEqual({ kind: "ask", needs: ["geolocation"] });
    expect(routePermission("notifications", [])).toEqual({ kind: "ask", needs: ["notifications"] });
    expect(routePermission("midiSysex", [])).toEqual({ kind: "ask", needs: ["midi"] });
    expect(routePermission("openExternal", [])).toEqual({ kind: "ask", needs: ["external-app"] });
  });

  it("splits media into camera and microphone; no type is denied", () => {
    expect(routePermission("media", ["audio", "video"])).toEqual({
      kind: "ask",
      needs: ["camera", "microphone"],
    });
    expect(routePermission("media", ["audio"])).toEqual({ kind: "ask", needs: ["microphone"] });
    expect(routePermission("media", ["unknown"])).toEqual({ kind: "deny" });
  });

  it("allows fullscreen and pointer lock, denies screen capture and anything unknown", () => {
    expect(routePermission("fullscreen", [])).toEqual({ kind: "allow" });
    expect(routePermission("pointerLock", [])).toEqual({ kind: "allow" });
    expect(routePermission("display-capture", [])).toEqual({ kind: "deny" });
    expect(routePermission("usb", [])).toEqual({ kind: "deny" });
    expect(routePermission("unknown", [])).toEqual({ kind: "deny" });
  });
});

describe("permissionOrigin and permissionPrompt", () => {
  it("keeps scheme, host and port of http(s) only", () => {
    expect(permissionOrigin("https://maps.example.com:8443/a?q=secret")).toBe(
      "https://maps.example.com:8443",
    );
    expect(permissionOrigin("file:///etc/passwd")).toBeNull();
    expect(permissionOrigin("not a url")).toBeNull();
  });

  it("says what the page wants", () => {
    expect(permissionPrompt(["geolocation"])).toBe("use your location");
    expect(permissionPrompt(["camera", "microphone"])).toBe("use your camera and microphone");
  });
});

describe("decideSitePermission", () => {
  it("asks when nothing is saved", () => {
    expect(decideSitePermission(["geolocation"], ctx)).toBe("ask");
  });

  it("applies saved answers; one block blocks camera + mic", () => {
    expect(decideSitePermission(["geolocation"], { ...ctx, saved: { geolocation: "allow" } })).toBe(
      "allowed (saved)",
    );
    const mixed = { ...ctx, saved: { camera: "allow", microphone: "block" } as const };
    expect(decideSitePermission(["camera", "microphone"], mixed)).toBe("blocked (saved)");
    expect(
      decideSitePermission(["camera", "microphone"], { ...ctx, saved: { camera: "allow" } }),
    ).toBe("ask");
  });

  it("uses a one-time grant", () => {
    const once = { ...ctx, grantedOnce: new Set(["geolocation"] as const) };
    expect(decideSitePermission(["geolocation"], once)).toBe("allowed (once)");
  });

  it("never asks while an agent acts, and never opens camera or mic then", () => {
    const acting = { ...ctx, agentActing: true };
    expect(decideSitePermission(["geolocation"], acting)).toBe("denied (agent acting)");
    expect(
      decideSitePermission(["geolocation"], { ...acting, saved: { geolocation: "allow" } }),
    ).toBe("allowed (saved)");
    expect(decideSitePermission(["camera"], { ...acting, saved: { camera: "allow" } })).toBe(
      "denied (agent acting)",
    );
  });

  it("caps the bars waiting on one page", () => {
    const busy = { ...ctx, pendingOnPage: () => MAX_PENDING_PER_PAGE };
    expect(decideSitePermission(["notifications"], busy)).toBe("denied (too many)");
  });

  it("counts as allowed only a saved or one-time grant", () => {
    expect(isAllowed(decideSitePermission(["geolocation"], ctx))).toBe(false);
    expect(
      isAllowed(decideSitePermission(["geolocation"], { ...ctx, saved: { geolocation: "allow" } })),
    ).toBe(true);
  });
});

describe("one-time grants", () => {
  it("last while the page stays on its origin", () => {
    grantOnce(7, "https://a.test", ["geolocation"]);
    expect(grantedOnceOn(7, "https://a.test").has("geolocation")).toBe(true);
    expect(grantedOnceOn(7, "https://b.test").size).toBe(0);
    forgetOnceUnless(7, "https://a.test");
    expect(grantedOnceOn(7, "https://a.test").size).toBe(1);
    forgetOnceUnless(7, "https://b.test");
    expect(grantedOnceOn(7, "https://a.test").size).toBe(0);
  });
});

describe("pending requests", () => {
  const add = (id: string, wcId: number, callback: (ok: boolean) => void) =>
    addPendingPermission({
      id,
      wcId,
      paneId: "p",
      projectId: "proj",
      origin: "https://a.test",
      host: "a.test",
      needs: ["geolocation"],
      callbacks: [callback],
      notifyClosed: () => {},
      timer: setTimeout(() => {}, 0),
    });

  it("settles once, with every waiting callback", () => {
    const first = vi.fn();
    const second = vi.fn();
    add("r1", 1, first);
    findPendingPermission(1, "https://a.test", ["geolocation"])?.callbacks.push(second);
    expect(settlePermission("r1", true)?.id).toBe("r1");
    expect(first).toHaveBeenCalledWith(true);
    expect(second).toHaveBeenCalledWith(true);
    expect(settlePermission("r1", false)).toBeUndefined();
  });

  it("denies a page's requests when it goes away", () => {
    const cb = vi.fn();
    add("r2", 2, cb);
    add("r3", 3, vi.fn());
    expect(pendingPermissionsOf(2)).toBe(1);
    denyPermissionsOf(2);
    expect(cb).toHaveBeenCalledWith(false);
    expect(pendingPermissionsOf(2)).toBe(0);
    expect(pendingPermissionsOf(3)).toBe(1);
    settlePermission("r3", false);
  });
});
