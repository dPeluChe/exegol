import { describe, expect, it } from "vitest";
import { migrateAppStore } from "./app";

describe("migrateAppStore", () => {
  it("v2 → v3: someone who finished onboarding does not get the welcome tour", () => {
    const state = migrateAppStore({ onboardingComplete: true }, 2);
    expect(state.welcomeTourSeen).toBe(true);
  });

  it("v2 → v3: a user still in onboarding keeps it unseen", () => {
    const state = migrateAppStore({ onboardingComplete: false }, 2);
    expect(state.welcomeTourSeen).toBeUndefined();
  });

  it("v1: a stale 'settings' view becomes the workspace (or projects without one)", () => {
    expect(migrateAppStore({ activeView: "settings", activeProjectId: "p" }, 1).activeView).toBe(
      "workspace",
    );
    expect(migrateAppStore({ activeView: "settings", activeProjectId: null }, 1).activeView).toBe(
      "projects",
    );
  });
});
