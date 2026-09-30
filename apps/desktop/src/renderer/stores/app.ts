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
    }),
    {
      name: "exegol-app-state",
      version: 2,
      // T120: dropped 'settings' from ActiveView. Coerce stale persisted
      // value so upgrading users don't rehydrate into a sidebarless state.
      migrate: (persisted, fromVersion) => {
        if (!persisted || typeof persisted !== "object") return persisted as AppStore;
        const state = persisted as {
          activeView?: string;
          activeProjectId?: string | null;
          sidebarCollapsed?: boolean;
        };
        if (fromVersion < 2 && state.activeView === "settings") {
          state.activeView = state.activeProjectId ? "workspace" : "projects";
        }
        return state as unknown as AppStore;
      },
      partialize: (state) => ({
        activeProjectId: state.activeProjectId,
        activeView: state.activeView,
        sidebarCollapsed: state.sidebarCollapsed,
        onboardingComplete: state.onboardingComplete,
        liveTabOrder: state.liveTabOrder,
        sidebarProjectsHeight: state.sidebarProjectsHeight,
        sidebarAgentsView: state.sidebarAgentsView,
      }),
    },
  ),
);
