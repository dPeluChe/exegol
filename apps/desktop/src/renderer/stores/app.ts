import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type ActiveView = 'projects' | 'workspace' | 'settings'

interface AppStore {
  /** Current main view */
  activeView: ActiveView
  setActiveView: (view: ActiveView) => void

  /** Currently selected project */
  activeProjectId: string | null
  setActiveProject: (id: string | null) => void

  /** Sidebar collapse state */
  sidebarCollapsed: boolean
  toggleSidebar: () => void

  /** Command palette open state */
  commandPaletteOpen: boolean
  setCommandPaletteOpen: (open: boolean) => void
}

export const useAppStore = create<AppStore>()(
  persist(
    (set) => ({
      activeView: 'projects',
      setActiveView: (view) => set({ activeView: view }),

      activeProjectId: null,
      setActiveProject: (id) =>
        set({
          activeProjectId: id,
          activeView: id ? 'workspace' : 'projects',
        }),

      sidebarCollapsed: false,
      toggleSidebar: () => set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),

      commandPaletteOpen: false,
      setCommandPaletteOpen: (open) => set({ commandPaletteOpen: open }),
    }),
    {
      name: 'exegol-app-state',
      partialize: (state) => ({
        activeProjectId: state.activeProjectId,
        activeView: state.activeView,
        sidebarCollapsed: state.sidebarCollapsed,
      }),
    }
  )
)
