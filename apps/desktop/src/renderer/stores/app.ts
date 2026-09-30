import { create } from "zustand";
import { persist } from "zustand/middleware";

/** "dashboard" is the cross-project view: no project is selected while it shows. */
type ActiveView = "projects" | "workspace" | "dashboard";

interface AppStore {
  /** Current main view */
  activeView: ActiveView;
  setActiveView: (view: ActiveView) => void;
  openDashboard: () => void;

  /** Currently selected project */
  activeProjectId: string | null;
  setActiveProject: (id: string | null) => void;

  /** Sidebar collapse state */
  sidebarCollapsed: boolean;
  toggleSidebar: () => void;

  /** Command palette open state */
  commandPaletteOpen: boolean;
  setCommandPaletteOpen: (open: boolean) => void;

  /** Height of the sidebar's Projects section dragged by the user (null = sized to content) */
  sidebarProjectsHeight: number | null;
  setSidebarProjectsHeight: (height: number | null) => void;

  /** Sidebar Agents section: the live agents or the Needs attention list */
  sidebarAgentsView: "agents" | "attention";
  setSidebarAgentsView: (view: "agents" | "attention") => void;

  /** Sidebar order of the live tab groups (Cmd+2..9), by `projectId:tabId` */
  liveTabOrder: string[];
  setLiveTabOrder: (order: string[]) => void;

  /** T148: first-run onboarding wizard completed (or skipped) */
  onboardingComplete: boolean;
  setOnboardingComplete: (complete: boolean) => void;

  /** Welcome tour shown after onboarding: seen or skipped */
  welcomeTourSeen: boolean;
  setWelcomeTourSeen: (seen: boolean) => void;
}

/** v2 (T120): a persisted 'settings' view would rehydrate sidebarless. v3: the welcome tour */
export function migrateAppStore(persisted: unknown, fromVersion: number): AppStore {
  if (!persisted || typeof persisted !== "object") return persisted as AppStore;
  const state = persisted as {
    activeView?: string;
    activeProjectId?: string | null;
    sidebarCollapsed?: boolean;
    onboardingComplete?: boolean;
    welcomeTourSeen?: boolean;
  };
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
      openDashboard: () => set({ activeView: "dashboard" }),

      activeProjectId: null,
      setActiveProject: (id) =>
        set({
          activeProjectId: id,
          activeView: id ? "workspace" : "projects",
        }),

      sidebarCollapsed: false,
      toggleSidebar: () => set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),

      commandPaletteOpen: false,
      setCommandPaletteOpen: (open) => set({ commandPaletteOpen: open }),

      sidebarProjectsHeight: null,
      setSidebarProjectsHeight: (height) => set({ sidebarProjectsHeight: height }),

      sidebarAgentsView: "agents",
      setSidebarAgentsView: (view) => set({ sidebarAgentsView: view }),

      liveTabOrder: [],
      setLiveTabOrder: (order) => set({ liveTabOrder: order }),

      onboardingComplete: false,
      setOnboardingComplete: (complete) => set({ onboardingComplete: complete }),

      welcomeTourSeen: false,
      setWelcomeTourSeen: (seen) => set({ welcomeTourSeen: seen }),
    }),
    {
      name: "exegol-app-state",
      version: 3,
      migrate: migrateAppStore,
      partialize: (state) => ({
        activeProjectId: state.activeProjectId,
        activeView: state.activeView,
        sidebarCollapsed: state.sidebarCollapsed,
        onboardingComplete: state.onboardingComplete,
        welcomeTourSeen: state.welcomeTourSeen,
        liveTabOrder: state.liveTabOrder,
        sidebarProjectsHeight: state.sidebarProjectsHeight,
        sidebarAgentsView: state.sidebarAgentsView,
      }),
    },
  ),
);
