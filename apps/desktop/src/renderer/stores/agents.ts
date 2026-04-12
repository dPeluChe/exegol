import type { Agent, AgentCliType, AgentStatus } from "@exegol/shared";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { getProjectState, useWorkspaceStore } from "./workspace";

// ─── Attention model (T57) ────────────────────────────────────────────────

export type AttentionLevel = "critical" | "action_needed" | "info";

export interface AttentionItem {
  agentId: string;
  projectId: string;
  cliType: string;
  taskDescription: string;
  level: AttentionLevel;
  reason: string;
  timestamp: number;
  read: boolean;
  pinned: boolean;
}

function statusToAttention(
  status: string,
  cliType: string,
): { level: AttentionLevel; reason: string } | null {
  // Shells never generate attention items
  if (cliType === "shell") return null;
  switch (status) {
    case "crashed":
      return { level: "critical", reason: "Agent crashed" };
    case "failed":
      return { level: "critical", reason: "Agent failed" };
    case "waiting_input":
      return { level: "action_needed", reason: "Waiting for input" };
    case "completed":
      return { level: "info", reason: "Task completed" };
    case "stopped":
      return { level: "info", reason: "Agent stopped" };
    default:
      return null;
  }
}

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
        for (const [paneId, pane] of Object.entries(getProjectState().panes)) {
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

      // T57: Mark as unread + add to attention inbox
      if (isFinalStatus || event.status === "waiting_input") {
        store.markUnread(event.agentId);
        store.addAttentionItem(event.agentId);
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

  /** Unread agent IDs — agents that completed while not focused */
  unreadAgents: Record<string, boolean>;
  markUnread: (id: string) => void;
  markRead: (id: string) => void;

  /** T57: Attention inbox — agents that need user attention, persisted across restarts */
  attentionItems: Record<string, AttentionItem>;
  /** Push an attention item (called from status push handler) */
  addAttentionItem: (agentId: string) => void;
  /** Mark an item as read (e.g., user clicked on it) */
  markAttentionRead: (agentId: string) => void;
  /** Dismiss an item entirely */
  dismissAttention: (agentId: string) => void;
  /** Toggle pin on an item */
  toggleAttentionPin: (agentId: string) => void;
  /** Dismiss all read + unpinned items */
  clearReadAttention: () => void;
  /** Get attention items sorted by priority */
  getSortedAttention: () => AttentionItem[];
  /** Count of unread attention items */
  getAttentionCount: () => number;
}

const ATTENTION_LEVEL_ORDER: Record<AttentionLevel, number> = {
  critical: 0,
  action_needed: 1,
  info: 2,
};

export const useAgentStore = create<AgentStore>()(
  persist(
    (set, get) => ({
      agents: {},
      focusedAgentId: null,
      unreadAgents: {},
      attentionItems: {},

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
          let added = 0;
          let merged = 0;

          for (const dbAgent of dbAgents) {
            const existing = updated[dbAgent.id];
            if (existing) {
              merged++;
              // Merge: keep live runtime state (currentStep from parser), update DB state
              updated[dbAgent.id] = {
                ...existing,
                status: dbAgent.status as AgentStatus,
                branchName: dbAgent.branchName ?? existing.branchName ?? null,
                currentStep: existing.currentStep ?? dbAgent.currentStep ?? null,
              };
            } else {
              added++;
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

          if (added > 0 || merged > 0) {
            console.log(
              `[AgentStore] syncFromDb: ${added} added, ${merged} merged, total=${Object.keys(updated).length}`,
            );
          }
          return { agents: updated };
        }),

      getAgentList: () => Object.values(get().agents),

      getAgent: (id) => get().agents[id],

      // ─── T57: Attention inbox ──────────────────────────────────────────────

      addAttentionItem: (agentId) =>
        set((s) => {
          const agent = s.agents[agentId];
          if (!agent) return s;
          const att = statusToAttention(agent.status, agent.cliType);
          if (!att) return s;
          // Don't overwrite a pinned item with a lower-priority one
          const existing = s.attentionItems[agentId];
          if (
            existing?.pinned &&
            ATTENTION_LEVEL_ORDER[att.level] > ATTENTION_LEVEL_ORDER[existing.level]
          ) {
            return s;
          }
          const item: AttentionItem = {
            agentId,
            projectId: agent.projectId,
            cliType: agent.cliType,
            taskDescription: agent.taskDescription,
            level: att.level,
            reason: att.reason,
            timestamp: Date.now(),
            read: s.focusedAgentId === agentId, // auto-read if focused
            pinned: existing?.pinned ?? false,
          };
          return { attentionItems: { ...s.attentionItems, [agentId]: item } };
        }),

      markAttentionRead: (agentId) =>
        set((s) => {
          const item = s.attentionItems[agentId];
          if (!item || item.read) return s;
          return {
            attentionItems: { ...s.attentionItems, [agentId]: { ...item, read: true } },
          };
        }),

      dismissAttention: (agentId) =>
        set((s) => {
          if (!s.attentionItems[agentId]) return s;
          const { [agentId]: _, ...rest } = s.attentionItems;
          return { attentionItems: rest };
        }),

      toggleAttentionPin: (agentId) =>
        set((s) => {
          const item = s.attentionItems[agentId];
          if (!item) return s;
          return {
            attentionItems: {
              ...s.attentionItems,
              [agentId]: { ...item, pinned: !item.pinned },
            },
          };
        }),

      clearReadAttention: () =>
        set((s) => {
          const kept: Record<string, AttentionItem> = {};
          for (const [id, item] of Object.entries(s.attentionItems)) {
            if (!item.read || item.pinned) kept[id] = item;
          }
          return { attentionItems: kept };
        }),

      getSortedAttention: () => {
        const items = Object.values(get().attentionItems);
        return items.sort((a, b) => {
          // Unread first
          if (a.read !== b.read) return a.read ? 1 : -1;
          // Then by level priority
          const levelDiff = ATTENTION_LEVEL_ORDER[a.level] - ATTENTION_LEVEL_ORDER[b.level];
          if (levelDiff !== 0) return levelDiff;
          // Then newest first
          return b.timestamp - a.timestamp;
        });
      },

      getAttentionCount: () => Object.values(get().attentionItems).filter((i) => !i.read).length,
    }),
    {
      name: "exegol-agent-attention",
      partialize: (state) => ({
        attentionItems: state.attentionItems,
      }),
    },
  ),
);
