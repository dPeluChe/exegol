import {
  type Agent,
  type AgentAccessMode,
  type AgentActivityLevel,
  type AgentCliType,
  type AgentStatus,
  classifyActivity,
} from "@exegol/shared";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { useAppStore } from "./app";
import { collectPaneIds, getProjectState, useWorkspaceStore } from "./workspace";

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

      const newStatus = event.status as AgentStatus;
      const update: Partial<AgentState> = {
        status: newStatus,
        currentStep: event.currentStep,
        activityLevel: classifyActivity(newStatus, event.currentStep),
      };
      if (event.claudeSessionId) update.claudeSessionId = event.claudeSessionId;
      store.updateAgent(event.agentId, update);

      // Add to attention inbox (markUnread is now derived from this)
      if (isFinalStatus || event.status === "waiting_input") {
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
  accessMode: AgentAccessMode | null;
  /** Claude session ID captured from startup output — used for --resume on re-spawn (T101). */
  claudeSessionId: string | null;
  /** T70: Derived activity level — busy/idle/neutral. Updated on every status change. */
  activityLevel: AgentActivityLevel;
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

  /** Sync agents from DB for a given project. Merges with existing live state. */
  syncFromDb: (projectId: string, dbAgents: Agent[]) => void;

  /**
   * Whether an agent is "unread" — derived from attentionItems.
   * An agent is unread if it has an attention item that hasn't been read.
   */
  isUnread: (id: string) => boolean;
  markRead: (id: string) => void;

  /** Attention inbox — agents needing user attention, persisted across restarts */
  attentionItems: Record<string, AttentionItem>;
  addAttentionItem: (agentId: string) => void;
  markAttentionRead: (agentId: string) => void;
  dismissAttention: (agentId: string) => void;
  toggleAttentionPin: (agentId: string) => void;
  clearReadAttention: () => void;
  /** Count of unread attention items (cached for badge rendering) */
  unreadAttentionCount: number;
}

const ATTENTION_LEVEL_ORDER: Record<AttentionLevel, number> = {
  critical: 0,
  action_needed: 1,
  info: 2,
};

/** Sort order for the TitleBar attention queue: pinned first, then unread, then level/recency. */
export function sortAttentionItems(items: AttentionItem[]): AttentionItem[] {
  return [...items].sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    if (a.read !== b.read) return a.read ? 1 : -1;
    const levelDiff = ATTENTION_LEVEL_ORDER[a.level] - ATTENTION_LEVEL_ORDER[b.level];
    if (levelDiff !== 0) return levelDiff;
    return b.timestamp - a.timestamp;
  });
}

/** Locate the workspace tab + pane showing a given agent, across all projects. */
function findAgentPane(
  agentId: string,
  projectId: string,
): { tabId: string; paneId: string } | null {
  const pw = useWorkspaceStore.getState().projectWorkspaces[projectId];
  if (!pw) return null;
  for (const tab of pw.tabs) {
    for (const paneId of collectPaneIds(tab.layout)) {
      if (pw.panes[paneId]?.agentId === agentId) {
        return { tabId: tab.id, paneId };
      }
    }
  }
  return null;
}

/**
 * Jump to the pane hosting `agentId` (T141): switches project/tab if needed,
 * focuses the pane, and marks the attention item read.
 */
export function jumpToAttentionItem(agentId: string, projectId: string): void {
  if (useAppStore.getState().activeProjectId !== projectId) {
    useAppStore.getState().setActiveProject(projectId);
  }
  const location = findAgentPane(agentId, projectId);
  if (location) {
    const ws = useWorkspaceStore.getState();
    ws.setActiveTab(location.tabId);
    ws.setFocusedPane(location.paneId);
  }
  useAgentStore.getState().setFocusedAgent(agentId);
}

export const useAgentStore = create<AgentStore>()(
  persist(
    (set, get) => ({
      agents: {},
      focusedAgentId: null,
      attentionItems: {},
      unreadAttentionCount: 0,

      setFocusedAgent: (id) => {
        if (id) {
          // Auto-mark as read when focused
          const s = get();
          const item = s.attentionItems[id];
          if (item && !item.read) {
            set({
              focusedAgentId: id,
              attentionItems: { ...s.attentionItems, [id]: { ...item, read: true } },
              unreadAttentionCount: Math.max(0, s.unreadAttentionCount - 1),
            });
          } else {
            set({ focusedAgentId: id });
          }
        } else {
          set({ focusedAgentId: id });
        }
      },

      isUnread: (id) => {
        const item = get().attentionItems[id];
        return !!item && !item.read;
      },

      markRead: (id) => get().markAttentionRead(id),

      updateAgent: (id, update) =>
        set((state) => {
          const existing = state.agents[id];
          if (!existing) return state;
          // T70: Auto-recompute activityLevel when status changes
          const merged = { ...existing, ...update };
          if (update.status && !update.activityLevel) {
            merged.activityLevel = classifyActivity(merged.status, merged.currentStep);
          }
          return { agents: { ...state.agents, [id]: merged } };
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
              const dbStatus = dbAgent.status as AgentStatus;
              updated[dbAgent.id] = {
                id: dbAgent.id,
                projectId: dbAgent.projectId,
                cliType: dbAgent.cliType as AgentCliType,
                status: dbStatus,
                currentStep: dbAgent.currentStep ?? null,
                taskDescription: dbAgent.taskDescription,
                branchName: dbAgent.branchName ?? null,
                tokenUsage: { input: 0, output: 0, cost: 0 },
                startedAt: dbAgent.startedAt,
                accessMode: dbAgent.accessMode ?? null,
                claudeSessionId: null,
                activityLevel: classifyActivity(dbStatus, dbAgent.currentStep),
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

      // ─── T57: Attention inbox ──────────────────────────────────────────────

      addAttentionItem: (agentId) =>
        set((s) => {
          const agent = s.agents[agentId];
          if (!agent) return s;
          const att = statusToAttention(agent.status, agent.cliType);
          if (!att) return s;
          const existing = s.attentionItems[agentId];
          if (
            existing?.pinned &&
            ATTENTION_LEVEL_ORDER[att.level] > ATTENTION_LEVEL_ORDER[existing.level]
          ) {
            return s;
          }
          const isRead = s.focusedAgentId === agentId;
          const wasUnread = existing && !existing.read;
          const item: AttentionItem = {
            agentId,
            projectId: agent.projectId,
            cliType: agent.cliType,
            taskDescription: agent.taskDescription,
            level: att.level,
            reason: att.reason,
            timestamp: Date.now(),
            read: isRead,
            pinned: existing?.pinned ?? false,
          };
          const countDelta = isRead ? 0 : wasUnread ? 0 : 1;
          return {
            attentionItems: { ...s.attentionItems, [agentId]: item },
            unreadAttentionCount: s.unreadAttentionCount + countDelta,
          };
        }),

      markAttentionRead: (agentId) =>
        set((s) => {
          const item = s.attentionItems[agentId];
          if (!item || item.read) return s;
          return {
            attentionItems: { ...s.attentionItems, [agentId]: { ...item, read: true } },
            unreadAttentionCount: Math.max(0, s.unreadAttentionCount - 1),
          };
        }),

      dismissAttention: (agentId) =>
        set((s) => {
          const item = s.attentionItems[agentId];
          if (!item) return s;
          const { [agentId]: _, ...rest } = s.attentionItems;
          const countDelta = item.read ? 0 : -1;
          return {
            attentionItems: rest,
            unreadAttentionCount: Math.max(0, s.unreadAttentionCount + countDelta),
          };
        }),

      toggleAttentionPin: (agentId) =>
        set((s) => {
          const item = s.attentionItems[agentId];
          if (!item) return s;
          return {
            attentionItems: { ...s.attentionItems, [agentId]: { ...item, pinned: !item.pinned } },
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
    }),
    {
      name: "exegol-agent-attention",
      partialize: (state) => ({
        attentionItems: state.attentionItems,
      }),
    },
  ),
);
