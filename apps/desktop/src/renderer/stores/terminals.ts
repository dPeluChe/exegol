import { create } from 'zustand'

export interface TerminalState {
  agentId: string
  /** Whether the xterm instance has been mounted and connected */
  ready: boolean
  /** Terminal dimensions */
  cols: number
  rows: number
}

interface TerminalStore {
  /** Active terminal sessions keyed by agent ID */
  terminals: Record<string, TerminalState>

  /** Create a terminal entry for an agent */
  createTerminal: (agentId: string) => void

  /** Mark a terminal as ready (xterm mounted) */
  setTerminalReady: (agentId: string) => void

  /** Update terminal dimensions */
  setTerminalSize: (agentId: string, cols: number, rows: number) => void

  /** Remove a terminal */
  removeTerminal: (agentId: string) => void

  /** Check if a terminal exists for an agent */
  hasTerminal: (agentId: string) => boolean
}

export const useTerminalStore = create<TerminalStore>((set, get) => ({
  terminals: {},

  createTerminal: (agentId) =>
    set((state) => {
      if (state.terminals[agentId]) return state
      return {
        terminals: {
          ...state.terminals,
          [agentId]: {
            agentId,
            ready: false,
            cols: 80,
            rows: 24,
          },
        },
      }
    }),

  setTerminalReady: (agentId) =>
    set((state) => {
      const terminal = state.terminals[agentId]
      if (!terminal) return state
      return {
        terminals: { ...state.terminals, [agentId]: { ...terminal, ready: true } },
      }
    }),

  setTerminalSize: (agentId, cols, rows) =>
    set((state) => {
      const terminal = state.terminals[agentId]
      if (!terminal) return state
      return {
        terminals: { ...state.terminals, [agentId]: { ...terminal, cols, rows } },
      }
    }),

  removeTerminal: (agentId) =>
    set((state) => {
      const { [agentId]: _, ...rest } = state.terminals
      return { terminals: rest }
    }),

  hasTerminal: (agentId) => agentId in get().terminals,
}))
