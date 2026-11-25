import type { AgentStatus } from "./agent";

// ─── Sessions ───────────────────────────────────────────────────────────────

export type RecentSession = {
  id: string;
  taskDescription: string;
  cliType: string;
  status: AgentStatus;
  startedAt: number | null;
  stoppedAt: number | null;
  projectName: string;
  projectId: string;
};

/** A past session a provider can reopen with its own resume flag (`agents.listResumable`). */
export type ResumableSession = {
  agentId: string;
  cliType: string;
  /** Session codename, when it had one — how the user knew this session. */
  alias: string | null;
  taskDescription: string;
  status: string;
  endedAt: number | null;
  /** The folder it ran in: its start folder, worktree or the project root */
  folder?: string | null;
};

/** Where a spawn WOULD run, resolved by the same code that will create it —
 *  the renderer cannot reproduce the worktree collision suffix. */
export type SpawnPreview = {
  cwd: string;
  /** The branch that will be created, suffixed if the requested one is taken. */
  branchName: string | null;
  /** True when an existing worktree already holds that branch and is reused. */
  reused: boolean;
};

/**
 * T181 — one row in Project › History.
 *
 * `origin` is the honest distinction, not a decoration: Exegol knows the score,
 * the spend and the oplog for what IT launched, and knows only that a session
 * happened for everything read out of a CLI's own on-disk store.
 */
export type HistoryEntry = {
  origin: "exegol" | "local";
  id: string;
  provider: string;
  /** Session codename for Exegol runs; the CLI's own title otherwise. */
  label: string;
  task: string | null;
  branch: string | null;
  startedAt: number | null;
  endedAt: number | null;
  /** Null for a local session — a store on disk records no outcome. */
  status: string | null;
  score: number | null;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  oplogEntries: number;
  hasFinalOutput: boolean;
  archived: boolean;
  /** The provider's own session id, when known — what its resume flag takes. */
  sessionId: string | null;
  /** CLI version that ran it, when the source records one. */
  version: string | null;
  /** Transcript size for a local session — with no score and no token count,
   *  it is the only signal of how much actually happened. 0 for Exegol rows,
   *  which have better evidence. */
  sizeBytes: number;
};
