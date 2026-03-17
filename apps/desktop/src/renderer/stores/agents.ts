import type { Agent, AgentCliType, AgentStatus } from "@exegol/shared";
import { create } from "zustand";

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
}

export const useAgentStore = create<AgentStore>((set, get) => ({
  agents: {},
  focusedAgentId: null,

  setFocusedAgent: (id) => set({ focusedAgentId: id }),

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
            branchName: null,
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
