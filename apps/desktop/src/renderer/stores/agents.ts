import type { Agent, AgentCliType, AgentStatus } from "@exegol/shared";
import { create } from "zustand";
import { useWorkspaceStore } from "./workspace";

// ─── Push event subscription (T17) ──────────────────────────────────────

let pushCleanup: (() => void) | null = null;

/** Start listening for agent status push events from main process */
export function startAgentStatusPush(): void {
  if (pushCleanup) return; // Already subscribed
  pushCleanup = window.api.onAgentStatus((event) => {
    const store = useAgentStore.getState();
    const existing = store.agents[event.agentId];
    if (existing) {
      const isFinalStatus = ["completed", "failed", "stopped", "crashed"].includes(event.status);

      // Auto-remove shell terminals when they finish (no need to keep in sidebar)
      // Also convert their pane to empty so it doesn't show read-only scrollback
      if (isFinalStatus && existing.cliType === "shell") {
        store.removeAgent(event.agentId);
        // Convert any terminal pane showing this agent to empty
        const ws = useWorkspaceStore.getState();
        for (const [paneId, pane] of Object.entries(ws.panes)) {
          if (pane.type === "terminal" && pane.agentId === event.agentId) {
            ws.updatePane(paneId, { type: "empty", agentId: undefined });
          }
        }
        return;
      }

      store.updateAgent(event.agentId, {
        status: event.status as AgentStatus,
        currentStep: event.currentStep,
      });

      // T57: Mark as unread when agent finishes (working → completed/failed/idle)
      if (isFinalStatus || event.status === "waiting_input") {
        store.markUnread(event.agentId);
      }
    }
  });
}

/** Stop listening for push events */
export function stopAgentStatusPush(): void {
  pushCleanup?.();
  pushCleanup = null;
}

export interface AgentState {
  id: string;
  projectId: string;
  cliType: AgentCliType;
  status: AgentStatus;
  currentStep: string | null;
  taskDescription: string;
  branchName: string | null;
  tokenUsage: { input: number; output: number; cost: number };
  startedAt: number | null;
}

interface AgentStore {
  /** Active agents keyed by ID */
  agents: Record<string, AgentState>;

  /** Which agent terminal is currently focused */
  focusedAgentId: string | null;
  setFocusedAgent: (id: string | null) => void;

  /** Update an agent's state (partial merge) */
  updateAgent: (id: string, update: Partial<AgentState>) => void;

  /** Add a new agent */
  addAgent: (agent: AgentState) => void;

  /** Remove an agent from the store */
  removeAgent: (id: string) => void;

  /** Clear all agents (e.g., when switching projects) */
  clearAgents: () => void;

  /** Sync agents from DB for a given project. Merges with existing live state. */
  syncFromDb: (projectId: string, dbAgents: Agent[]) => void;

  /** Get agents as an array for rendering */
  getAgentList: () => AgentState[];

  /** Get a single agent by ID */
  getAgent: (id: string) => AgentState | undefined;

  /** Unread agent IDs — agents that completed while not focused (T57) */
  unreadAgents: Record<string, boolean>;
  markUnread: (id: string) => void;
  markRead: (id: string) => void;
}

export const useAgentStore = create<AgentStore>((set, get) => ({
  agents: {},
  focusedAgentId: null,
  unreadAgents: {},

  setFocusedAgent: (id) => {
    if (id) {
      set((s) => {
        const { [id]: _, ...rest } = s.unreadAgents;
        return { focusedAgentId: id, unreadAgents: rest };
      });
    } else {
      set({ focusedAgentId: id });
    }
  },

  markUnread: (id) =>
    set((s) => {
      if (s.focusedAgentId === id) return s;
      if (s.unreadAgents[id]) return s; // Already unread
      return { unreadAgents: { ...s.unreadAgents, [id]: true } };
    }),

  markRead: (id) =>
    set((s) => {
      if (!s.unreadAgents[id]) return s;
      const { [id]: _, ...rest } = s.unreadAgents;
      return { unreadAgents: rest };
    }),

  updateAgent: (id, update) =>
    set((state) => {
      const existing = state.agents[id];
      if (!existing) return state;
      return { agents: { ...state.agents, [id]: { ...existing, ...update } } };
    }),

  addAgent: (agent) =>
    set((state) => ({
      agents: { ...state.agents, [agent.id]: agent },
    })),

  removeAgent: (id) =>
    set((state) => {
      const { [id]: _, ...rest } = state.agents;
      const focusedAgentId = state.focusedAgentId === id ? null : state.focusedAgentId;
      return { agents: rest, focusedAgentId };
    }),

  clearAgents: () => set({ agents: {}, focusedAgentId: null }),

  syncFromDb: (_projectId, dbAgents) =>
    set((state) => {
      const updated = { ...state.agents };

      for (const dbAgent of dbAgents) {
        const existing = updated[dbAgent.id];
        if (existing) {
          // Merge: keep live runtime state (currentStep from parser), update DB state
          updated[dbAgent.id] = {
            ...existing,
            status: dbAgent.status as AgentStatus,
            branchName: dbAgent.branchName ?? existing.branchName ?? null,
            currentStep: existing.currentStep ?? dbAgent.currentStep ?? null,
          };
        } else {
          // New from DB — agent we don't have in memory yet
          updated[dbAgent.id] = {
            id: dbAgent.id,
            projectId: dbAgent.projectId,
            cliType: dbAgent.cliType as AgentCliType,
            status: dbAgent.status as AgentStatus,
            currentStep: dbAgent.currentStep ?? null,
            taskDescription: dbAgent.taskDescription,
            branchName: dbAgent.branchName ?? null,
            tokenUsage: { input: 0, output: 0, cost: 0 },
            startedAt: dbAgent.startedAt,
          };
        }
      }

      return { agents: updated };
    }),

  getAgentList: () => Object.values(get().agents),

  getAgent: (id) => get().agents[id],
}));
