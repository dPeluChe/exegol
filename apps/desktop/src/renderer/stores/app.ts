import { create } from "zustand";
import { persist } from "zustand/middleware";

/** "dashboard" is the cross-project view: no project is selected while it shows. */
type ActiveView = "projects" | "workspace" | "dashboard";

export const SIDEBAR_VIEWS = ["agents", "projects", "attention"] as const;
export type SidebarView = (typeof SIDEBAR_VIEWS)[number];

export const isSidebarView = (value: unknown): value is SidebarView =>
  SIDEBAR_VIEWS.includes(value as SidebarView);

interface AppStore {
  /** Current main view */
  activeView: ActiveView;
  setActiveView: (view: ActiveView) => void;
  openDashboard: () => void;

  /** Currently selected project */
  activeProjectId: string | null;
  setActiveProject: (id: string | null) => void;

  /** The view Projects was opened over (it keeps the project and the workspace mounted): Back /
   *  Esc returns there; null after a reload, then Back returns to the workspace of the project */
  projectsFrom: Exclude<ActiveView, "projects"> | null;
  openProjects: () => void;
  closeProjects: () => void;

  /** Sidebar collapse state */
  sidebarCollapsed: boolean;
  toggleSidebar: () => void;

  /** Command palette open state */
  commandPaletteOpen: boolean;
  setCommandPaletteOpen: (open: boolean) => void;

  /** Footer reads Claude's plan usage with Claude Code's own login: only once the user asks */
  claudePlanUsage: boolean;
  setClaudePlanUsage: (on: boolean) => void;

  /** Sidebar Projects order: by Cmd+n, then live, then name; or the order dragged by hand */
  projectsOrder: "auto" | "manual";
  setProjectsOrder: (order: "auto" | "manual") => void;

  /** The sidebar's view: live agents, projects or the Needs attention list */
  sidebarView: SidebarView;
  setSidebarView: (view: SidebarView) => void;
  /** The rail's view buttons: expand the sidebar on that view */
  openSidebarView: (view: SidebarView) => void;
  /** Cmd+Shift+B: the next view, expanding the sidebar */
  cycleSidebarView: () => void;

  /** Agents view: only the busy sessions */
  sidebarActiveOnly: boolean;
  setSidebarActiveOnly: (on: boolean) => void;

  /** Sidebar order of the live project cards (sets the Cmd+2..9 project order), by project id */
  liveProjectOrder: string[];
  setLiveProjectOrder: (order: string[]) => void;

  /** T148: first-run onboarding wizard completed (or skipped) */
  onboardingComplete: boolean;
  setOnboardingComplete: (complete: boolean) => void;

  /** Welcome tour shown after onboarding: seen or skipped */
  welcomeTourSeen: boolean;
  setWelcomeTourSeen: (seen: boolean) => void;
}

/** The v3 tab-group order (`projectId:tabId`) as a project order: a project's first tab wins */
export function projectOrderFromTabKeys(keys: string[]): string[] {
  return [...new Set(keys.map((k) => k.split(":")[0] ?? k))];
}

/**
 * v2 (T120): a persisted 'settings' view would rehydrate sidebarless. v3: the welcome tour.
 * v4: the sidebar orders projects, not tabs. v5: one sidebar view selector, no Projects split
 */
export function migrateAppStore(persisted: unknown, fromVersion: number): AppStore {
  if (!persisted || typeof persisted !== "object") return persisted as AppStore;
  const state = persisted as {
    activeView?: string;
    activeProjectId?: string | null;
    sidebarCollapsed?: boolean;
    onboardingComplete?: boolean;
    welcomeTourSeen?: boolean;
    liveTabOrder?: unknown;
    liveProjectOrder?: string[];
    sidebarAgentsView?: unknown;
    sidebarProjectsHeight?: unknown;
    sidebarView?: SidebarView;
  };
  if (fromVersion < 4) {
    const keys = Array.isArray(state.liveTabOrder) ? state.liveTabOrder : [];
    state.liveProjectOrder = projectOrderFromTabKeys(
      keys.filter((k): k is string => typeof k === "string"),
    );
    delete state.liveTabOrder;
  }
  if (fromVersion < 5) {
    state.sidebarView = isSidebarView(state.sidebarAgentsView) ? state.sidebarAgentsView : "agents";
    delete state.sidebarAgentsView;
    delete state.sidebarProjectsHeight;
  }
  if (fromVersion < 2 && state.activeView === "settings") {
    state.activeView = state.activeProjectId ? "workspace" : "projects";
  }
  // Users who finished onboarding before the tour existed are not new: skip it
  if (fromVersion < 3 && state.onboardingComplete) state.welcomeTourSeen = true;
  return state as unknown as AppStore;
}

export const useAppStore = create<AppStore>()(
  persist(
    (set) => ({
      activeView: "projects",
      setActiveView: (view) => set({ activeView: view }),
      openDashboard: () => set({ activeView: "dashboard", projectsFrom: null }),

      activeProjectId: null,
      setActiveProject: (id) =>
        set({
          activeProjectId: id,
          activeView: id ? "workspace" : "projects",
          projectsFrom: null,
        }),

      projectsFrom: null,
      openProjects: () =>
        set((s) =>
          s.activeView === "projects" ? {} : { activeView: "projects", projectsFrom: s.activeView },
        ),
      closeProjects: () =>
        set((s) => {
          const to = s.projectsFrom ?? (s.activeProjectId ? "workspace" : null);
          return to ? { activeView: to, projectsFrom: null } : {};
        }),

      sidebarCollapsed: false,
      toggleSidebar: () => set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),

      commandPaletteOpen: false,
      setCommandPaletteOpen: (open) => set({ commandPaletteOpen: open }),

      claudePlanUsage: false,
      setClaudePlanUsage: (on) => set({ claudePlanUsage: on }),

      projectsOrder: "auto",
      setProjectsOrder: (order) => set({ projectsOrder: order }),

      sidebarView: "agents",
      setSidebarView: (view) => set({ sidebarView: view }),
      openSidebarView: (view) => set({ sidebarView: view, sidebarCollapsed: false }),
      cycleSidebarView: () =>
        set((s) => ({
          sidebarView:
            SIDEBAR_VIEWS[(SIDEBAR_VIEWS.indexOf(s.sidebarView) + 1) % SIDEBAR_VIEWS.length] ??
            "agents",
          sidebarCollapsed: false,
        })),

      sidebarActiveOnly: false,
      setSidebarActiveOnly: (on) => set({ sidebarActiveOnly: on }),

      liveProjectOrder: [],
      setLiveProjectOrder: (order) => set({ liveProjectOrder: order }),

      onboardingComplete: false,
      setOnboardingComplete: (complete) => set({ onboardingComplete: complete }),

      welcomeTourSeen: false,
      setWelcomeTourSeen: (seen) => set({ welcomeTourSeen: seen }),
    }),
    {
      name: "exegol-app-state",
      version: 5,
      migrate: migrateAppStore,
      partialize: (state) => ({
        activeProjectId: state.activeProjectId,
        activeView: state.activeView,
        sidebarCollapsed: state.sidebarCollapsed,
        onboardingComplete: state.onboardingComplete,
        welcomeTourSeen: state.welcomeTourSeen,
        liveProjectOrder: state.liveProjectOrder,
        sidebarView: state.sidebarView,
        sidebarActiveOnly: state.sidebarActiveOnly,
        projectsOrder: state.projectsOrder,
        claudePlanUsage: state.claudePlanUsage,
      }),
    },
  ),
);
