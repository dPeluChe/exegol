import { type AgentCliType, type AgentStatus, classifyActivity } from "@exegol/shared";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { useShallow } from "zustand/react/shallow";
import { shallow } from "zustand/shallow";
import { nextActivitySince } from "../lib/busy-time";
import { isClaudeQuestion } from "../lib/claude-question";
import { trpcMutate } from "../lib/trpc-client";
import { findAgentPane, findPane, focusPane, showProject } from "./agent-navigation";
import {
  type AgentState,
  type AgentStore,
  ATTENTION_LEVEL_ORDER,
  type AttentionItem,
  attentionInterrupts,
  FLEET_SYNC,
  pruneTurns,
  statusToAttention,
  syncedStatus,
  withoutTurn,
} from "./agent-state";
import { useAppStore } from "./app";
import { noteDeskActivity } from "./desk-activity";
import { useNotificationPrefsStore } from "./notification-prefs";
import { useWatchStore } from "./watch";
import { useWorkspaceStore } from "./workspace";

export { findAgentPane, findPane, focusPane, showProject } from "./agent-navigation";
export {
  type AgentState,
  type AttentionCause,
  type AttentionItem,
  type AttentionLevel,
  attentionInterrupts,
  FLEET_SYNC,
  followUpsKey,
  isLiveAgent,
  isPaneAgentStale,
  isWorking,
  shellClosesOn,
  sortAttentionItems,
  syncedStatus,
  toAgentState,
} from "./agent-state";

/**
 * Sessions closed here whose stop/archive has not reached the DB yet. A sync already on its way
 * still lists them as live and re-added them: the Dashboard pin then showed a black mirror of a
 * dead PTY with no Resume, and the paneless sweep stopped them a second time
 */
const removedIds = new Set<string>();

/**
 * Go to an agent's pane from anywhere (dashboard, sidebar, hotkey, toast):
 * switches project/tab if needed, focuses the pane, marks its attention read.
 */
export function jumpToAgent(agentId: string, projectId: string): void {
  const browserPane = useAgentStore.getState().attentionItems[agentId]?.paneId;
  const location =
    (browserPane && findPane(projectId, browserPane)) || findAgentPane(agentId, projectId);
  if (location) {
    focusPane(projectId, location.tabId, location.paneId);
  } else {
    showProject(projectId);
    const ws = useWorkspaceStore.getState();
    // No pane shows it (closed, or spawned headless): a new tab, never replacing the user's panes
    ws.addTab();
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
      syncedProjects: {},
      focusedAgentId: null,
      attentionItems: {},
      unseenTurns: {},
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
              unseenTurns: withoutTurn(s.unseenTurns, id),
              unreadAttentionCount: Math.max(0, s.unreadAttentionCount - 1),
            });
          } else {
            set({ focusedAgentId: id, unseenTurns: withoutTurn(s.unseenTurns, id) });
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
          if ((update.status || "currentStep" in update) && !update.activityLevel) {
            merged.activityLevel = classifyActivity(
              merged.status,
              merged.currentStep,
              merged.cliType,
            );
          }
          merged.activitySince = nextActivitySince(
            existing,
            merged.activityLevel,
            update.activitySince ?? Date.now(),
          );
          // A new agents object re-renders every pane subscribed to the map
          return shallow(merged, existing) ? state : { agents: { ...state.agents, [id]: merged } };
        }),

      addAgent: (agent) => {
        removedIds.delete(agent.id);
        set((state) => ({
          agents: {
            ...state.agents,
            [agent.id]: { ...agent, activitySince: agent.activitySince ?? Date.now() },
          },
        }));
      },

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
        removedIds.add(id);
        // A closed session leaves Watching too ("session gone" strips were left behind)
        useWatchStore.getState().unwatch(id);
        noteDeskActivity(id, null);
        set((state) => {
          const { [id]: _, ...rest } = state.agents;
          const focusedAgentId = state.focusedAgentId === id ? null : state.focusedAgentId;
          return { agents: rest, focusedAgentId, unseenTurns: withoutTurn(state.unseenTurns, id) };
        });
      },

      syncFromDb: (_projectId, dbAgents) =>
        set((state) => {
          const updated = { ...state.agents };
          const syncedProjects =
            _projectId === FLEET_SYNC || state.syncedProjects[_projectId]
              ? state.syncedProjects
              : { ...state.syncedProjects, [_projectId]: true as const };
          let added = 0;
          let merged = 0;
          let changed = syncedProjects !== state.syncedProjects;

          const listed = new Set(dbAgents.map((a) => a.id));
          // Gone from the project's list too (archived or deleted): the close has landed. The
          // fleet lists live rows only, so a session it omits may still be mid-archive
          if (_projectId !== FLEET_SYNC) {
            for (const id of removedIds) if (!listed.has(id)) removedIds.delete(id);
          }

          for (const dbAgent of dbAgents) {
            if (removedIds.has(dbAgent.id)) continue;
            const existing = updated[dbAgent.id];
            if (existing) {
              merged++;
              // Merge: keep live runtime state (currentStep from parser), update DB state
              const roles = dbAgent.modelRoles ?? existing.modelRoles ?? null;
              const next: AgentState = {
                ...existing,
                status: syncedStatus(existing.status, dbAgent.status as AgentStatus),
                branchName: dbAgent.branchName ?? existing.branchName ?? null,
                alias: dbAgent.alias ?? existing.alias ?? null,
                cliName: dbAgent.cliName ?? existing.cliName ?? null,
                currentStep: existing.currentStep ?? dbAgent.currentStep ?? null,
                muted: dbAgent.muted ?? existing.muted ?? false,
                prWatch: dbAgent.prWatch ?? existing.prWatch ?? false,
                suspended: dbAgent.suspendedAt != null,
                cliType: dbAgent.cliType as AgentCliType,
                launchedInShell: dbAgent.launchedInShell ?? existing.launchedInShell ?? false,
                cliVersion: dbAgent.cliVersion ?? existing.cliVersion ?? null,
                model: dbAgent.model ?? existing.model ?? null,
                // Each fetch parses a new object: equal roles keep the old one
                modelRoles: shallow(roles, existing.modelRoles ?? null)
                  ? existing.modelRoles
                  : roles,
                yolo: dbAgent.yolo ?? existing.yolo ?? null,
                claudeSessionId: existing.claudeSessionId ?? dbAgent.claudeSessionId ?? null,
              };
              // Same values keep the same object: per-agent selectors and memos skip the poll
              if (!shallow(next, existing)) {
                updated[dbAgent.id] = next;
                changed = true;
              }
            } else {
              added++;
              changed = true;
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
                cliName: dbAgent.cliName ?? null,
                tokenUsage: { input: 0, output: 0, cost: 0 },
                startedAt: dbAgent.startedAt,
                accessMode: dbAgent.accessMode ?? null,
                claudeSessionId: dbAgent.claudeSessionId ?? null,
                activityLevel: classifyActivity(dbStatus, dbAgent.currentStep, dbAgent.cliType),
                activitySince: dbAgent.statusChangedAt ?? Date.now(),
                muted: dbAgent.muted ?? false,
                prWatch: dbAgent.prWatch ?? false,
                suspended: dbAgent.suspendedAt != null,
                launchedInShell: dbAgent.launchedInShell ?? false,
                cliVersion: dbAgent.cliVersion ?? null,
                model: dbAgent.model ?? null,
                modelRoles: dbAgent.modelRoles ?? null,
                yolo: dbAgent.yolo ?? null,
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
          // Also Claude's idle reminders kept from before the hook matcher: no question behind them
          const stale = Object.entries(state.attentionItems).filter(([id, item]) => {
            if (item.projectId !== _projectId) return false;
            if (!dbIds.has(id)) return true;
            const agent = updated[id];
            return (
              !!agent &&
              agent.cliType === "claude-code" &&
              agent.status === "waiting_input" &&
              item.level === "action_needed" &&
              !item.paneId &&
              !isClaudeQuestion(item, agent)
            );
          });
          const unseenTurns = pruneTurns(state.unseenTurns, _projectId, dbIds);
          if (stale.length === 0) {
            if (!changed && unseenTurns === state.unseenTurns) return state;
            return { agents: changed ? updated : state.agents, syncedProjects, unseenTurns };
          }

          let unreadAttentionCount = state.unreadAttentionCount;
          const attentionItems = { ...state.attentionItems };
          for (const [id, item] of stale) {
            if (!item.read) {
              unreadAttentionCount = Math.max(0, unreadAttentionCount - 1);
            }
            delete attentionItems[id];
          }

          return {
            agents: changed ? updated : state.agents,
            attentionItems,
            unseenTurns,
            unreadAttentionCount,
            syncedProjects,
          };
        }),

      // ─── T57: Attention inbox ──────────────────────────────────────────────

      addAttentionItem: (agentId, cause) =>
        set((s) => {
          const agent = s.agents[agentId];
          // Muted and suspended sessions never ask for attention
          if (!agent || agent.muted || agent.suspended) return s;
          const att = cause ?? statusToAttention(agent.status, agent.cliType);
          if (!att) return s;
          const existing = s.attentionItems[agentId];
          if (
            existing?.pinned &&
            ATTENTION_LEVEL_ORDER[att.level] > ATTENTION_LEVEL_ORDER[existing.level]
          ) {
            return s;
          }
          const level = useNotificationPrefsStore.getState().levelOf(agent.projectId);
          const isRead = s.focusedAgentId === agentId || !attentionInterrupts(level, att.level);
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
            ...(cause?.paneId ? { paneId: cause.paneId } : {}),
            ...(cause?.stuck ? { stuck: true } : {}),
          };
          const countDelta = isRead ? 0 : wasUnread ? 0 : 1;
          return {
            attentionItems: { ...s.attentionItems, [agentId]: item },
            unreadAttentionCount: s.unreadAttentionCount + countDelta,
          };
        }),

      markAttentionRead: (agentId) =>
        set((s) => {
          const unseenTurns = withoutTurn(s.unseenTurns, agentId);
          const item = s.attentionItems[agentId];
          if (!item || item.read) return unseenTurns === s.unseenTurns ? s : { unseenTurns };
          return {
            attentionItems: { ...s.attentionItems, [agentId]: { ...item, read: true } },
            unseenTurns,
            unreadAttentionCount: Math.max(0, s.unreadAttentionCount - 1),
          };
        }),

      noteTurnUnseen: (agentId) =>
        set((s) => {
          const agent = s.agents[agentId];
          if (!agent || agent.muted || agent.suspended || agent.cliType === "shell") return s;
          // The Dashboard covers the panes, so the focused one may be off screen
          const onScreen =
            s.focusedAgentId === agentId && useAppStore.getState().activeView !== "dashboard";
          if (onScreen || s.unseenTurns[agentId]) return s;
          return { unseenTurns: { ...s.unseenTurns, [agentId]: agent.projectId } };
        }),

      markTurnSeen: (agentId) => {
        if (agentId in get().unseenTurns) {
          set((s) => ({ unseenTurns: withoutTurn(s.unseenTurns, agentId) }));
        }
      },

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
        unseenTurns: state.unseenTurns,
      }),
    },
  ),
);

/** A project's agents matching `pred`, by element: a push for an agent outside them, or one that
 *  changes nothing they hold, does not re-render the caller */
export function useProjectAgents(
  projectId: string | null | undefined,
  pred: (a: AgentState) => boolean,
): AgentState[] {
  return useAgentStore(
    useShallow((s) => Object.values(s.agents).filter((a) => a.projectId === projectId && pred(a))),
  );
}
