import {
  type Agent,
  type AgentAccessMode,
  type AgentActivityLevel,
  type AgentCliType,
  type AgentStatus,
  classifyActivity,
  ENDED_STATUSES,
  type InterruptionLevel,
  interruptionAllows,
  LIVE_STATUSES,
} from "@exegol/shared";
/** A shell that ended closes its pane; a crashed one (the sidecar took it) keeps it, so it
 *  reopens there in its last folder */
export const shellClosesOn = (status: string) =>
  status === "completed" || status === "failed" || status === "stopped";

/** A session that counts as an open agent: live, and not a plain shell */
export const isLiveAgent = (a: Pick<AgentState, "cliType" | "status">) =>
  a.cliType !== "shell" && LIVE_STATUSES.has(a.status);

export const withoutTurn = (turns: Record<string, string>, id: string) => {
  if (!(id in turns)) return turns;
  const { [id]: _, ...rest } = turns;
  return rest;
};

export const pruneTurns = (turns: Record<string, string>, projectId: string, ids: Set<string>) => {
  const gone = Object.keys(turns).filter((id) => turns[id] === projectId && !ids.has(id));
  if (gone.length === 0) return turns;
  const kept = { ...turns };
  for (const id of gone) delete kept[id];
  return kept;
};

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
  /** Raised by the stuck-turn sweep: Company shows it apart from other info items */
  stuck?: boolean;
  pinned: boolean;
  /** Agent browser: the pane the agent needs the user in (clears on hand-back, not on running) */
  paneId?: string;
}

export type AttentionCause = {
  level: AttentionLevel;
  reason: string;
  paneId?: string;
  stuck?: boolean;
};

export function statusToAttention(
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

export const followUpsKey = (agentId: string) => ["agents", "followUps", agentId];

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
    cliName: agent.cliName ?? null,
    tokenUsage: { input: 0, output: 0, cost: 0 },
    startedAt: agent.startedAt,
    accessMode: agent.accessMode ?? null,
    claudeSessionId: agent.claudeSessionId ?? null,
    activityLevel: classifyActivity(agent.status, agent.currentStep, agent.cliType),
    activitySince: agent.statusChangedAt ?? undefined,
    muted: agent.muted ?? false,
    prWatch: agent.prWatch ?? false,
    suspended: agent.suspendedAt != null,
    launchedInShell: agent.launchedInShell ?? false,
    cliVersion: agent.cliVersion ?? null,
    model: agent.model ?? null,
    modelRoles: agent.modelRoles ?? null,
    yolo: agent.yolo ?? null,
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
  /** Its name inside its CLI, when Exegol has read one */
  cliName?: string | null;
  tokenUsage: { input: number; output: number; cost: number };
  startedAt: number | null;
  accessMode: AgentAccessMode | null;
  /** Claude session ID captured from startup output — used for --resume on re-spawn (T101). */
  claudeSessionId: string | null;
  /** T70: Derived activity level — busy/idle/neutral. Updated on every status change. */
  activityLevel: AgentActivityLevel;
  /** When activityLevel last changed (ms): the start of the current turn or wait */
  activitySince?: number;
  /** T181: dismissed from the dashboard. Kept in the store on purpose — removing
   *  the row makes an open terminal pane look like a leftover from a previous
   *  session, and WorkspacePane converts it to empty, destroying the transcript. */
  archived?: boolean;
  /** Alive but quiet: no Needs attention entry, no notifications */
  muted?: boolean;
  /** T142: Exegol tells it about its PR's checks, reviews and conflicts */
  prWatch?: boolean;
  /** Stopped on purpose to resume later; quiet like muted */
  suspended?: boolean;
  /** Typed in a plain terminal: its CLI can exit back to the shell prompt (Continue) */
  launchedInShell?: boolean;
  /** The CLI version the session started with (a newer install means restart to update) */
  cliVersion?: string | null;
  /** Launch choices, kept so a saved layout relaunches the same agent */
  model?: string | null;
  modelRoles?: Record<string, string> | null;
  yolo?: boolean | null;
}

export interface AgentStore {
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
   * Projects whose full agent list (listAgents) has landed. Panes mount before it does, so
   * "agent not in store" only means "gone" once the agent's own project synced. The fleet sync
   * (live agents only) never counts: it turned stopped/suspended sessions' panes into launchers.
   * Not persisted: a fresh process has not synced, whatever the last one did.
   */
  syncedProjects: Record<string, true>;

  /**
   * Whether an agent is "unread" — derived from attentionItems.
   * An agent is unread if it has an attention item that hasn't been read.
   */
  isUnread: (id: string) => boolean;
  markRead: (id: string) => void;

  /** Attention inbox — agents needing user attention, persisted across restarts */
  attentionItems: Record<string, AttentionItem>;
  /** Sessions whose last turn ended unseen (agent id to project id): look when free, not a
   *  question, so no attention item, amber dot or badge */
  unseenTurns: Record<string, string>;
  noteTurnUnseen: (agentId: string) => void;
  markTurnSeen: (agentId: string) => void;
  /** `cause` overrides the status-derived reason (PR watch) */
  addAttentionItem: (agentId: string, cause?: AttentionCause) => void;
  markAttentionRead: (agentId: string) => void;
  dismissAttention: (agentId: string) => void;
  toggleAttentionPin: (agentId: string) => void;
  clearReadAttention: () => void;
  /** Count of unread attention items (cached for badge rendering) */
  unreadAttentionCount: number;
}

/** A quiet item is still recorded as read: dots, idle suspend and the question guards read it */
export function attentionInterrupts(level: InterruptionLevel, item: AttentionLevel): boolean {
  return interruptionAllows(level, item === "info" ? "agent:notice" : "agent:attention");
}

export const ATTENTION_LEVEL_ORDER: Record<AttentionLevel, number> = {
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

/**
 * A list fetched before an exit can land after its push: an ended session never goes back to a
 * live status from a list (a revived one is a new row, or a status push)
 */
export function syncedStatus(current: AgentStatus, listed: AgentStatus): AgentStatus {
  return ENDED_STATUSES.has(current) && LIVE_STATUSES.has(listed) ? current : listed;
}

/** Mid-turn: not free for a restart, counted as running work */
export const isWorking = (a: Pick<AgentState, "status">) =>
  a.status === "running" || a.status === "spawning";

/** syncFromDb id of the cross-project live-agent list: it syncs no project */
export const FLEET_SYNC = "__fleet__";

/**
 * A pane's session is gone (archived or closed) when it ended and is still missing from the store
 * after its own project's list landed. A crashed shell is kept: its pane respawns a shell.
 */
export function isPaneAgentStale(
  agent: Pick<Agent, "id" | "projectId" | "status" | "cliType">,
  state: Pick<AgentStore, "agents" | "syncedProjects">,
): boolean {
  return (
    state.syncedProjects[agent.projectId] === true &&
    ENDED_STATUSES.has(agent.status) &&
    !state.agents[agent.id] &&
    !(agent.cliType === "shell" && agent.status === "crashed")
  );
}
