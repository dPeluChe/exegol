import { nanoid } from "nanoid";
import { create } from "zustand";

export interface TerminalState {
  agentId: string;
  /** Whether the xterm instance has been mounted and connected */
  ready: boolean;
  /** Terminal dimensions */
  cols: number;
  rows: number;
}

export type PaneNode =
  | { type: "terminal"; id: string; agentId: string | null }
  | {
      type: "split";
      id: string;
      direction: "horizontal" | "vertical";
      children: PaneNode[];
    };

interface TerminalStore {
  /** Active terminal sessions keyed by agent ID */
  terminals: Record<string, TerminalState>;

  /** Pane layouts keyed by root agent ID */
  paneLayouts: Record<string, PaneNode>;

  createTerminal: (agentId: string) => void;
  setTerminalReady: (agentId: string) => void;
  setTerminalSize: (agentId: string, cols: number, rows: number) => void;
  removeTerminal: (agentId: string) => void;
  hasTerminal: (agentId: string) => boolean;

  /** Initialize pane layout for an agent (single terminal pane) */
  initLayout: (agentId: string) => void;
  /** Get the pane layout for an agent */
  getLayout: (agentId: string) => PaneNode | undefined;
  /** Split a pane into two — new pane starts unassigned (agentId: null) */
  splitPane: (rootAgentId: string, paneId: string, direction: "horizontal" | "vertical") => void;
  /** Close a pane (remove it from the tree) */
  closePane: (rootAgentId: string, paneId: string) => void;
  /** Assign an agent to a specific pane */
  setPaneAgent: (rootAgentId: string, paneId: string, newAgentId: string) => void;
}

export const useTerminalStore = create<TerminalStore>((set, get) => ({
  terminals: {},
  paneLayouts: {},

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

  removeTerminal: (agentId) =>
    set((state) => {
      const { [agentId]: _, ...rest } = state.terminals;
      return { terminals: rest };
    }),

  hasTerminal: (agentId) => agentId in get().terminals,

  initLayout: (agentId) =>
    set((state) => {
      if (state.paneLayouts[agentId]) return state;
      return {
        paneLayouts: {
          ...state.paneLayouts,
          [agentId]: { type: "terminal", id: nanoid(8), agentId },
        },
      };
    }),

  getLayout: (agentId) => get().paneLayouts[agentId],

  splitPane: (rootAgentId, paneId, direction) =>
    set((state) => {
      const root = state.paneLayouts[rootAgentId];
      if (!root) return state;

      const newRoot = splitNodeById(root, paneId, direction);
      if (newRoot === root) return state;
      return {
        paneLayouts: { ...state.paneLayouts, [rootAgentId]: newRoot },
      };
    }),

  closePane: (rootAgentId, paneId) =>
    set((state) => {
      const root = state.paneLayouts[rootAgentId];
      if (!root) return state;

      if (root.id === paneId) {
        const { [rootAgentId]: _, ...rest } = state.paneLayouts;
        return { paneLayouts: rest };
      }

      const newRoot = removeNodeById(root, paneId);
      if (!newRoot) {
        const { [rootAgentId]: _, ...rest } = state.paneLayouts;
        return { paneLayouts: rest };
      }
      return {
        paneLayouts: { ...state.paneLayouts, [rootAgentId]: newRoot },
      };
    }),

  setPaneAgent: (rootAgentId, paneId, newAgentId) =>
    set((state) => {
      const root = state.paneLayouts[rootAgentId];
      if (!root) return state;

      const newRoot = updatePaneAgent(root, paneId, newAgentId);
      if (newRoot === root) return state;
      return {
        paneLayouts: { ...state.paneLayouts, [rootAgentId]: newRoot },
      };
    }),
}));

/** Split a pane — new child starts with agentId: null (unassigned) */
function splitNodeById(
  node: PaneNode,
  paneId: string,
  direction: "horizontal" | "vertical",
): PaneNode {
  if (node.id === paneId) {
    return {
      type: "split",
      id: nanoid(8),
      direction,
      children: [node, { type: "terminal", id: nanoid(8), agentId: null }],
    };
  }

  if (node.type === "split") {
    const newChildren = node.children.map((child) => splitNodeById(child, paneId, direction));
    if (newChildren.some((c, i) => c !== node.children[i])) {
      return { ...node, children: newChildren };
    }
  }

  return node;
}

function removeNodeById(node: PaneNode, paneId: string): PaneNode | null {
  if (node.type === "terminal") {
    return node.id === paneId ? null : node;
  }

  const remaining = node.children
    .map((child) => removeNodeById(child, paneId))
    .filter((child): child is PaneNode => child !== null);

  if (remaining.length === 0) return null;
  if (remaining.length === 1) return remaining[0] ?? null;
  return { ...node, children: remaining };
}

function updatePaneAgent(node: PaneNode, paneId: string, newAgentId: string): PaneNode {
  if (node.type === "terminal") {
    if (node.id === paneId) {
      return { ...node, agentId: newAgentId };
    }
    return node;
  }

  const newChildren = node.children.map((child) => updatePaneAgent(child, paneId, newAgentId));
  if (newChildren.some((c, i) => c !== node.children[i])) {
    return { ...node, children: newChildren };
  }
  return node;
}
