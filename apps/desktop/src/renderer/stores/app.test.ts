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

  it("v3 → v4: a corrupt saved order migrates to [], non-string entries are dropped", () => {
    expect(migrateAppStore({ liveTabOrder: "a:t1" }, 3).liveProjectOrder).toEqual([]);
    expect(migrateAppStore({ liveTabOrder: { a: 1 } }, 3).liveProjectOrder).toEqual([]);
    expect(
      migrateAppStore({ liveTabOrder: [1, "a:t1", null, "b:t2"] }, 3).liveProjectOrder,
    ).toEqual(["a", "b"]);
  });
});

describe("migrateAppStore v5: sidebar views", () => {
  it("drops the Projects split height and the old Agents switch, defaulting to Agents", () => {
    const state = migrateAppStore({ sidebarProjectsHeight: 240, sidebarAgentsView: "agents" }, 4);
    expect(state.sidebarView).toBe("agents");
    expect("sidebarProjectsHeight" in state).toBe(false);
    expect("sidebarAgentsView" in state).toBe(false);
  });

  it("keeps a picked Needs attention list as that view", () => {
    expect(migrateAppStore({ sidebarAgentsView: "attention" }, 4).sidebarView).toBe("attention");
  });

  it("a missing or corrupt old value becomes Agents", () => {
    expect(migrateAppStore({}, 4).sidebarView).toBe("agents");
    expect(migrateAppStore({ sidebarAgentsView: 3 }, 4).sidebarView).toBe("agents");
  });

  it("a v5 state is left alone", () => {
    expect(migrateAppStore({ sidebarView: "projects" }, 5).sidebarView).toBe("projects");
  });
});

describe("openSidebarView", () => {
  it("expands a collapsed sidebar on the picked view", () => {
    useAppStore.setState({ sidebarCollapsed: true, sidebarView: "agents" });
    useAppStore.getState().openSidebarView("attention");
    expect(useAppStore.getState()).toMatchObject({
      sidebarCollapsed: false,
      sidebarView: "attention",
    });
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
