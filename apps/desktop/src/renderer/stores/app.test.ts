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

  it("v3 → v4: the tab-group order becomes a project order, a project's first tab wins", () => {
    const state = migrateAppStore({ liveTabOrder: ["b:t2", "a:t1", "b:t5", "c:t3", "a:t4"] }, 3);
    expect(state.liveProjectOrder).toEqual(["b", "a", "c"]);
    expect("liveTabOrder" in state).toBe(false);
  });

  it("v3 → v4: no saved order is an empty project order", () => {
    expect(migrateAppStore({}, 3).liveProjectOrder).toEqual([]);
  });
});

describe("Projects view return", () => {
  it("opens over the workspace, keeping the project, and Back returns to that view", () => {
    useAppStore.setState({ activeView: "dashboard", activeProjectId: "p1", projectsFrom: null });
    useAppStore.getState().openProjects();
    useAppStore.getState().openProjects();
    expect(useAppStore.getState()).toMatchObject({
      activeView: "projects",
      activeProjectId: "p1",
      projectsFrom: "dashboard",
    });
    useAppStore.getState().closeProjects();
    expect(useAppStore.getState()).toMatchObject({ activeView: "dashboard", projectsFrom: null });
  });

  it("after a reload Back goes to the project's workspace; with no project it stays", () => {
    useAppStore.setState({ activeView: "projects", activeProjectId: "p2", projectsFrom: null });
    useAppStore.getState().closeProjects();
    expect(useAppStore.getState().activeView).toBe("workspace");
    useAppStore.setState({ activeView: "projects", activeProjectId: null, projectsFrom: null });
    useAppStore.getState().closeProjects();
    expect(useAppStore.getState().activeView).toBe("projects");
  });
});
