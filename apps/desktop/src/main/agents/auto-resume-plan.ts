import type { Agent } from "@exegol/shared";
import type Database from "libsql";
import { getAgent, getProject, setAgentSuspended, updateAgentStatus } from "../db/queries";
import { logger } from "../lib/logger";
import { idleDays, type LostSession, splitLost, takeShellFolder } from "./auto-resume";
import { settleLost } from "./lost-sessions";
import { getProviderRegistry } from "./registry";

export interface KeptSession {
  agentId: string;
  projectId: string;
  projectName: string;
  /** Alias, else the CLI's display name */
  name: string;
  cliType: string;
}

export interface AutoResumeOutcome {
  id: string;
  cliType: string;
  outcome: "resumed" | "failed" | "skipped";
  reason?: string;
}

export const KEPT_STEP = "Suspended (idle 3+ days)";
export const NO_PANE_STEP = "Suspended (no pane to resume in)";
/** The renderer's reason for a session it had no pane for */
export const NO_PANE = "no pane";

/** Stopped and suspended: the pane shows Resume, not the crash */
function suspendLost(db: Database.Database, id: string, step: string, now: number): void {
  setAgentSuspended(db, id, Math.floor(now / 1000));
  updateAgentStatus(db, id, "stopped", step);
}

/** The recent lost sessions go back to the renderer to resume; the rest are kept suspended */
export function planLostResume(
  db: Database.Database,
  lost: LostSession[],
  now = Date.now(),
  pinned: ReadonlySet<string> = new Set(),
): { resume: Array<Agent & { lastActiveAt: number }>; kept: KeptSession[] } {
  const { resume, keep } = splitLost(lost, now, undefined, pinned);
  const kept: KeptSession[] = [];
  for (const s of keep) {
    const agent = getAgent(db, s.id);
    if (!agent) continue;
    suspendLost(db, s.id, KEPT_STEP, now);
    logger.info(
      `[AutoResume] ${s.id} ${agent.cliType} -> kept suspended (idle ${idleDays(now - s.lastActiveAt)})`,
    );
    kept.push({
      agentId: s.id,
      projectId: agent.projectId,
      projectName: getProject(db, agent.projectId)?.name ?? agent.projectId,
      name: agent.alias ?? getProviderRegistry().get(agent.cliType)?.name ?? agent.cliType,
      cliType: agent.cliType,
    });
  }
  settleLost(keep.map((s) => s.id));
  const agents = resume.flatMap((s) => {
    const agent = getAgent(db, s.id);
    return agent?.status === "crashed" ? [{ ...agent, lastActiveAt: s.lastActiveAt }] : [];
  });
  return { resume: agents, kept };
}

/** What the renderer did with the ones it was handed. One it skipped (no pane) is suspended
 *  rather than left crashed */
export function finishAutoResume(
  db: Database.Database,
  outcomes: AutoResumeOutcome[],
  totalMs: number,
  kept: number,
  now = Date.now(),
): void {
  const count = (o: AutoResumeOutcome["outcome"]) => outcomes.filter((x) => x.outcome === o).length;
  for (const o of outcomes) {
    if (o.reason === NO_PANE && getAgent(db, o.id)?.status === "crashed") {
      suspendLost(db, o.id, NO_PANE_STEP, now);
    }
    const folder = takeShellFolder(o.id);
    const notes = [o.reason, o.cliType === "shell" && o.outcome === "resumed" ? folder : undefined]
      .filter(Boolean)
      .join(", ");
    logger.info(`[AutoResume] ${o.id} ${o.cliType} -> ${o.outcome}${notes ? ` (${notes})` : ""}`);
  }
  settleLost(outcomes.map((o) => o.id));
  logger.info(
    `[AutoResume] done in ${totalMs}ms: ${count("resumed")} resumed, ${count("failed")} failed, ${count("skipped")} skipped, ${kept} kept suspended`,
  );
}
