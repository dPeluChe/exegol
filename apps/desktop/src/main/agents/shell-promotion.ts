import { AGENT_CLI_TYPES, type AgentCliType, LIVE_STATUSES } from "@exegol/shared";
import type Database from "libsql";
import { logger } from "../lib/logger";
import { matchShellClis, providerCommands, readProcessTable } from "../system/shell-clis";
import { pickAgentCodename } from "./agent-names";
import type { SessionMaps } from "./agent-session-callbacks";
import { attachOutputPipeline, detachOutputPipeline } from "./output-pipeline";
import { broadcastAgentStatus } from "./spawn-env";

/** A terminal session the watcher looks at: a plain shell, or one already promoted */
export interface TerminalSession {
  id: string;
  pid: number;
  projectId: string;
  cliType: string;
  alias: string | null;
  launchedInShell: boolean;
}

export type ShellTransition =
  /** A CLI runs below the shell: the session becomes that agent (or switches to it) */
  | { id: string; kind: "promote"; cliType: AgentCliType }
  /** The CLI exited: back at the prompt, still the same agent */
  | { id: string; kind: "prompt" };

const KNOWN_CLIS = new Set<string>(AGENT_CLI_TYPES);

/** What each session should become, given the CLI found below its shell (if any) */
export function planShellTransitions(
  sessions: TerminalSession[],
  found: Record<string, string>,
  isParsing: (id: string) => boolean,
): ShellTransition[] {
  const plan: ShellTransition[] = [];
  for (const s of sessions) {
    const cli = found[s.id];
    if (cli && KNOWN_CLIS.has(cli)) {
      if (s.cliType !== cli || !isParsing(s.id)) {
        plan.push({ id: s.id, kind: "promote", cliType: cli as AgentCliType });
      }
    } else if (s.launchedInShell && isParsing(s.id)) {
      plan.push({ id: s.id, kind: "prompt" });
    }
  }
  return plan;
}

function listTerminalSessions(db: Database.Database): TerminalSession[] {
  const statuses = [...LIVE_STATUSES];
  const rows = db
    .prepare(
      `SELECT id, pid, project_id, cli_type, alias, launched_in_shell FROM agents
       WHERE (cli_type = 'shell' OR launched_in_shell = 1) AND pid IS NOT NULL
       AND status IN (${statuses.map(() => "?").join(",")})`,
    )
    .all(...statuses) as {
    id: string;
    pid: number;
    project_id: string;
    cli_type: string;
    alias: string | null;
    launched_in_shell: number;
  }[];
  return rows.map((r) => ({
    id: r.id,
    pid: r.pid,
    projectId: r.project_id,
    cliType: r.cli_type,
    alias: r.alias,
    launchedInShell: r.launched_in_shell === 1,
  }));
}

function applyTransition(
  db: Database.Database,
  maps: SessionMaps,
  session: TerminalSession,
  step: ShellTransition,
): void {
  const ctx = maps.contexts.get(session.id);
  if (step.kind === "promote") {
    // Same row, pane, PTY and scrollback: only what it is changes
    const alias = session.alias ?? pickAgentCodename(db);
    db.prepare(
      `UPDATE agents SET cli_type = ?, launched_in_shell = 1, alias = ?, status = 'running',
       current_step = NULL WHERE id = ?`,
    ).run(step.cliType, alias, session.id);
    if (ctx) {
      ctx.cliType = step.cliType;
      ctx.launchedInShell = true;
      attachOutputPipeline(maps, ctx);
    }
    logger.info(`[ShellPromotion] ${session.id} became ${step.cliType}`);
    broadcastAgentStatus({
      agentId: session.id,
      projectId: session.projectId,
      status: "running",
      currentStep: null,
      cliType: step.cliType,
      timestamp: Date.now(),
      alias,
      launchedInShell: true,
    });
    return;
  }
  // The prompt's own output must not be read as the agent's status
  detachOutputPipeline(maps, session.id);
  db.prepare("UPDATE agents SET status = 'idle', current_step = NULL WHERE id = ?").run(session.id);
  logger.info(`[ShellPromotion] ${session.id} (${session.cliType}) is back at its shell prompt`);
  broadcastAgentStatus({
    agentId: session.id,
    projectId: session.projectId,
    status: "idle",
    currentStep: null,
    cliType: session.cliType,
    timestamp: Date.now(),
    launchedInShell: true,
  });
}

const POLL_MS = 3_000;

/**
 * An agent CLI typed in a plain terminal (any provider) turns that session into the agent:
 * rename, status, attention, resume and scoring then work as for one Exegol launched.
 * One `ps` per tick, only while a terminal session is live.
 */
export function startShellPromotion(db: Database.Database, maps: SessionMaps): () => void {
  let busy = false;
  const tick = async () => {
    if (busy) return;
    busy = true;
    try {
      const sessions = listTerminalSessions(db);
      if (sessions.length === 0) return;
      const found = matchShellClis(sessions, await readProcessTable(), providerCommands());
      const byId = new Map(sessions.map((s) => [s.id, s]));
      for (const step of planShellTransitions(sessions, found, (id) =>
        maps.outputProcessors.has(id),
      )) {
        const session = byId.get(step.id);
        if (session) applyTransition(db, maps, session, step);
      }
    } catch (err) {
      logger.warn("[ShellPromotion] Tick failed:", err);
    } finally {
      busy = false;
    }
  };
  const timer = setInterval(() => void tick(), POLL_MS);
  timer.unref?.();
  return () => clearInterval(timer);
}
