import { create } from 'zustand'
import type { AgentStatus, AgentCliType } from '@exegol/shared'

export interface AgentState {
  id: string
  projectId: string
  cliType: AgentCliType
  status: AgentStatus
  currentStep: string | null
  taskDescription: string
  branchName: string | null
  tokenUsage: { input: number; output: number; cost: number }
  startedAt: number | null
}

interface AgentStore {
  /** Active agents keyed by ID */
  agents: Record<string, AgentState>

  /** Which agent terminal is currently focused */
  focusedAgentId: string | null
  setFocusedAgent: (id: string | null) => void

  /** Update an agent's state (partial merge) */
  updateAgent: (id: string, update: Partial<AgentState>) => void

  /** Add a new agent */
  addAgent: (agent: AgentState) => void

  /** Remove an agent from the store */
  removeAgent: (id: string) => void

  /** Clear all agents (e.g., when switching projects) */
  clearAgents: () => void

  /** Get agents as an array for rendering */
  getAgentList: () => AgentState[]

  /** Get a single agent by ID */
  getAgent: (id: string) => AgentState | undefined
}

export const useAgentStore = create<AgentStore>((set, get) => ({
  agents: {},
  focusedAgentId: null,

  setFocusedAgent: (id) => set({ focusedAgentId: id }),

  updateAgent: (id, update) =>
    set((state) => {
      const existing = state.agents[id]
      if (!existing) return state
      return { agents: { ...state.agents, [id]: { ...existing, ...update } } }
    }),

  addAgent: (agent) =>
    set((state) => ({
      agents: { ...state.agents, [agent.id]: agent },
    })),

  removeAgent: (id) =>
    set((state) => {
      const { [id]: _, ...rest } = state.agents
      const focusedAgentId =
        state.focusedAgentId === id ? null : state.focusedAgentId
      return { agents: rest, focusedAgentId }
    }),

  clearAgents: () => set({ agents: {}, focusedAgentId: null }),

  getAgentList: () => Object.values(get().agents),

  getAgent: (id) => get().agents[id],
}))
