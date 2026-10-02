import { describe, expect, it } from "vitest";
import { migrateAppStore, useAppStore } from "./app";

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

describe("Projects view return", () => {
  it("Back returns to the project and view it was opened from", () => {
    useAppStore.setState({ activeView: "workspace", activeProjectId: "p1", projectsReturn: null });
    useAppStore.getState().openProjects();
    expect(useAppStore.getState()).toMatchObject({ activeView: "projects", activeProjectId: null });
    useAppStore.getState().closeProjects();
    expect(useAppStore.getState()).toMatchObject({
      activeView: "workspace",
      activeProjectId: "p1",
      projectsReturn: null,
    });
  });

  it("reopening while on Projects keeps the original return; nowhere to go is a no-op", () => {
    useAppStore.setState({ activeView: "dashboard", activeProjectId: "p2", projectsReturn: null });
    useAppStore.getState().openProjects();
    useAppStore.getState().openProjects();
    expect(useAppStore.getState().projectsReturn).toEqual({ view: "dashboard", projectId: "p2" });
    useAppStore.getState().setActiveProject("p3");
    expect(useAppStore.getState().projectsReturn).toBeNull();
    useAppStore.setState({ activeView: "projects", activeProjectId: null });
    useAppStore.getState().closeProjects();
    expect(useAppStore.getState().activeView).toBe("projects");
  });
});
