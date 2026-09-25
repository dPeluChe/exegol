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
import { shallow } from "zustand/shallow";
import { switchSection } from "../lib/switch-section";
import { trpcMutate } from "../lib/trpc-client";
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

      // Add to attention inbox (markUnread is now derived from this).
      // waiting_input alone is a TURN BOUNDARY (T123: every reply ends there)
      // — only real attention (permission prompt/question) earns an inbox
      // entry, or idle agents show amber dots forever (verify round 3).
      const needsAttention = event.needsAttention === true;
      // T123 hooks are claude-only: other CLIs never emit needsAttention, so
      // their questions would never reach the inbox. Fall back to the scraped
      // running→waiting transition for them — transition-gated so idle or
      // reattached agents don't earn amber dots (verify round 3).
      const scrapedAttention =
        existing.cliType !== "claude-code" &&
        (existing.status === "running" || existing.status === "spawning");
      if (
        isFinalStatus ||
        (event.status === "waiting_input" && (needsAttention || scrapedAttention))
      ) {
        store.addAttentionItem(event.agentId);
      } else if (newStatus === "running") {
        // Answering the prompt RESOLVES the attention (verify round 3: items
        // stayed amber for 54m after approval). Review items for finished
        // agents stay until dismissed — only action_needed auto-clears.
        const item = useAgentStore.getState().attentionItems[event.agentId];
        if (item && item.level === "action_needed") {
          store.dismissAttention(event.agentId);
        }
      }
    }
  });
}

/** Stop listening for push events */
export function stopAgentStatusPush(): void {
  pushCleanup?.();
  pushCleanup = null;
}

/**
 * Build the store shape from a spawn/DB agent. Nine call sites used to hand-copy
 * these fields, so every new column (alias, T167) silently stopped reaching the
 * UI — panes kept showing the provider instead of the session name.
 */
export function toAgentState(agent: Agent, overrides?: Partial<AgentState>): AgentState {
  return {
    id: agent.id,
    projectId: agent.projectId,
    cliType: agent.cliType,
    status: agent.status,
    currentStep: agent.currentStep,
    taskDescription: agent.taskDescription,
    branchName: agent.branchName ?? null,
    alias: agent.alias ?? null,
    tokenUsage: { input: 0, output: 0, cost: 0 },
    startedAt: agent.startedAt,
    accessMode: agent.accessMode ?? null,
    claudeSessionId: null,
    activityLevel: classifyActivity(agent.status, agent.currentStep),
    muted: agent.muted ?? false,
    suspended: agent.suspendedAt != null,
    ...overrides,
  };
}

export interface AgentState {
  id: string;
  projectId: string;
  cliType: AgentCliType;
  status: AgentStatus;
  currentStep: string | null;
  taskDescription: string;
  branchName: string | null;
  /** T160: session alias — addressing name for agent_send + display label. */
  alias?: string | null;
  tokenUsage: { input: number; output: number; cost: number };
  startedAt: number | null;
  accessMode: AgentAccessMode | null;
  /** Claude session ID captured from startup output — used for --resume on re-spawn (T101). */
  claudeSessionId: string | null;
  /** T70: Derived activity level — busy/idle/neutral. Updated on every status change. */
  activityLevel: AgentActivityLevel;
  /** T181: dismissed from the dashboard. Kept in the store on purpose — removing
   *  the row makes an open terminal pane look like a leftover from a previous
   *  session, and WorkspacePane converts it to empty, destroying the transcript. */
  archived?: boolean;
  /** Alive but quiet: no Needs attention entry, no notifications */
  muted?: boolean;
  /** Stopped on purpose to resume later; quiet like muted */
  suspended?: boolean;
}

interface AgentStore {
  /** Active agents keyed by ID */
  agents: Record<string, AgentState>;

  /** Which agent terminal is currently focused */
  focusedAgentId: string | null;
  setFocusedAgent: (id: string | null) => void;
  stopFocusedAgent: () => void;

  /** Update an agent's state (partial merge) */
  updateAgent: (id: string, update: Partial<AgentState>) => void;

  /** Add a new agent */
  addAgent: (agent: AgentState) => void;

  /** Remove an agent from the store */
  removeAgent: (id: string) => void;
  markArchived: (id: string) => void;

  /** Sync agents from DB for a given project. Merges with existing live state. */
  syncFromDb: (projectId: string, dbAgents: Agent[]) => void;

  /**
   * False until the first syncFromDb lands. Panes mount before it does, so
   * "agent not in store" means "not loaded yet", not "gone" — and acting on
   * that distinction destructively (converting a pane to empty) threw away
   * crashed sessions with their resume affordance on every restart.
   * Not persisted: a fresh process has not synced, whatever the last one did.
   */
  hasSyncedFromDb: boolean;

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
export function findAgentPane(
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

/** Bring a project's workspace on screen from anywhere, the Dashboard included */
function showProject(projectId: string): void {
  if (useAppStore.getState().activeProjectId !== projectId) {
    useAppStore.getState().setActiveProject(projectId);
  }
  switchSection("agents");
}

/** Open a file in the active tab's Files pane, or in a new Files tab */
export function openFileInWorkspace(projectId: string, filePath: string): void {
  showProject(projectId);
  const ws = useWorkspaceStore.getState();
  const pw = getProjectState();
  const tab = pw.tabs.find((t) => t.id === pw.activeTabId);
  const filesPane = tab
    ? collectPaneIds(tab.layout).find((id) => pw.panes[id]?.type === "files")
    : undefined;
  if (filesPane) {
    ws.updatePane(filesPane, { openFile: filePath, openFileAt: Date.now() });
    ws.setFocusedPane(filesPane);
    return;
  }
  ws.addTab("Files");
  const paneId = useWorkspaceStore.getState().focusedPaneId;
  if (paneId) ws.updatePane(paneId, { type: "files", openFile: filePath, openFileAt: Date.now() });
}

/** Show a project's tab (and pane) */
export function focusPane(projectId: string, tabId: string, paneId?: string): void {
  showProject(projectId);
  const ws = useWorkspaceStore.getState();
  ws.setActiveTab(tabId);
  if (paneId) ws.setFocusedPane(paneId);
}

/**
 * Go to an agent's pane from anywhere (dashboard, sidebar, hotkey, toast):
 * switches project/tab if needed, focuses the pane, marks its attention read.
 */
export function jumpToAgent(agentId: string, projectId: string): void {
  const location = findAgentPane(agentId, projectId);
  if (location) {
    focusPane(projectId, location.tabId, location.paneId);
  } else {
    showProject(projectId);
    const ws = useWorkspaceStore.getState();
    // No pane shows it (closed, or spawned headless): a new tab, never replacing the user's panes
    const agent = useAgentStore.getState().agents[agentId];
    ws.addTab(agent?.alias ?? agent?.cliType);
    const paneId = useWorkspaceStore.getState().focusedPaneId;
    if (paneId) ws.updatePane(paneId, { type: "terminal", agentId });
  }
  // Focusing marks its attention item read
  useAgentStore.getState().setFocusedAgent(agentId);
}

export const useAgentStore = create<AgentStore>()(
  persist(
    (set, get) => ({
      agents: {},
      hasSyncedFromDb: false,
      focusedAgentId: null,
      attentionItems: {},
      unreadAttentionCount: 0,

      stopFocusedAgent: () => {
        const id = get().focusedAgentId;
        if (id) trpcMutate("agents.stop", { id }).catch(() => {});
      },

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
          // A new agents object re-renders every pane subscribed to the map
          return shallow(merged, existing) ? state : { agents: { ...state.agents, [id]: merged } };
        }),

      addAgent: (agent) =>
        set((state) => ({
          agents: { ...state.agents, [agent.id]: agent },
        })),

      markArchived: (id) =>
        set((state) => {
          const agent = state.agents[id];
          if (!agent) return state;
          return { agents: { ...state.agents, [id]: { ...agent, archived: true } } };
        }),

      removeAgent: (id) => {
        // Verify round 3: a removed agent must not haunt the attention
        // inbox forever (persisted items lingered for closed tabs).
        get().dismissAttention(id);
        set((state) => {
          const { [id]: _, ...rest } = state.agents;
          const focusedAgentId = state.focusedAgentId === id ? null : state.focusedAgentId;
          return { agents: rest, focusedAgentId };
        });
      },

      syncFromDb: (_projectId, dbAgents) =>
        set((state) => {
          const updated = { ...state.agents };
          const hasSyncedFromDb = true;
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
                alias: dbAgent.alias ?? existing.alias ?? null,
                currentStep: existing.currentStep ?? dbAgent.currentStep ?? null,
                muted: dbAgent.muted ?? existing.muted ?? false,
                suspended: dbAgent.suspendedAt != null,
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
                alias: dbAgent.alias ?? null,
                tokenUsage: { input: 0, output: 0, cost: 0 },
                startedAt: dbAgent.startedAt,
                accessMode: dbAgent.accessMode ?? null,
                claudeSessionId: null,
                activityLevel: classifyActivity(dbStatus, dbAgent.currentStep),
                muted: dbAgent.muted ?? false,
                suspended: dbAgent.suspendedAt != null,
              };
            }
          }

          if (added > 0 || merged > 0) {
            console.log(
              `[AgentStore] syncFromDb: ${added} added, ${merged} merged, total=${Object.keys(updated).length}`,
            );
          }

          // Verify round 3: prune persisted attention items whose agent no
          // longer exists in this project's DB (deleted/closed tabs lingered
          // in the inbox for hours). Other projects' items are untouched.
          // Identity-stable: untouched state when nothing pruned, or this
          // 30s poll re-renders every attention subscriber for no change.
          const dbIds = new Set(dbAgents.map((a) => a.id));
          const stale = Object.entries(state.attentionItems).filter(
            ([id, item]) => item.projectId === _projectId && !dbIds.has(id),
          );
          if (stale.length === 0) return { agents: updated, hasSyncedFromDb };

          let unreadAttentionCount = state.unreadAttentionCount;
          const attentionItems = { ...state.attentionItems };
          for (const [id, item] of stale) {
            if (!item.read) {
              unreadAttentionCount = Math.max(0, unreadAttentionCount - 1);
            }
            delete attentionItems[id];
          }

          return { agents: updated, attentionItems, unreadAttentionCount, hasSyncedFromDb };
        }),

      // ─── T57: Attention inbox ──────────────────────────────────────────────

      addAttentionItem: (agentId) =>
        set((s) => {
          const agent = s.agents[agentId];
          // Muted and suspended sessions never ask for attention
          if (!agent || agent.muted || agent.suspended) return s;
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
