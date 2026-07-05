import { create } from "zustand";

export interface TerminalState {
  agentId: string;
  /** Whether the xterm instance has been mounted and connected */
  ready: boolean;
  /** Terminal dimensions */
  cols: number;
  rows: number;
}

interface TerminalStore {
  /** Active terminal sessions keyed by agent ID */
  terminals: Record<string, TerminalState>;

  createTerminal: (agentId: string) => void;
  setTerminalReady: (agentId: string) => void;
  setTerminalSize: (agentId: string, cols: number, rows: number) => void;
  hasTerminal: (agentId: string) => boolean;
}

export const useTerminalStore = create<TerminalStore>((set, get) => ({
  terminals: {},

  createTerminal: (agentId) =>
    set((state) => {
      if (state.terminals[agentId]) return state;
      return {
        terminals: {
          ...state.terminals,
          [agentId]: { agentId, ready: false, cols: 80, rows: 24 },
        },
      };
    }),

  setTerminalReady: (agentId) =>
    set((state) => {
      const terminal = state.terminals[agentId];
      if (!terminal) return state;
      return {
        terminals: { ...state.terminals, [agentId]: { ...terminal, ready: true } },
      };
    }),

  setTerminalSize: (agentId, cols, rows) =>
    set((state) => {
      const terminal = state.terminals[agentId];
      if (!terminal) return state;
      return {
        terminals: { ...state.terminals, [agentId]: { ...terminal, cols, rows } },
      };
    }),

  hasTerminal: (agentId) => agentId in get().terminals,
}));
