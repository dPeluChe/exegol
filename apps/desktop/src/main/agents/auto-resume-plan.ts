import type { Agent } from "@exegol/shared";
import type Database from "libsql";
import { getAgent, getProject, setAgentSuspended, updateAgentStatus } from "../db/queries";
import { logger } from "../lib/logger";
import { idleDays, type LostSession, splitLost } from "./auto-resume";
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

let keptCount = 0;

/** The recent lost sessions go back to the renderer to resume; the rest become suspended
 *  (stopped, Resume in their pane), not crashed */
export function planLostResume(
  db: Database.Database,
  lost: LostSession[],
  now = Date.now(),
): { resume: Array<Agent & { lastActiveAt: number }>; kept: KeptSession[] } {
  const { resume, keep } = splitLost(lost, now);
  const kept: KeptSession[] = [];
  for (const s of keep) {
    const agent = getAgent(db, s.id);
    if (!agent) continue;
    setAgentSuspended(db, s.id, Math.floor(now / 1000));
    updateAgentStatus(db, s.id, "stopped");
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
  keptCount = kept.length;
  const agents = resume.flatMap((s) => {
    const agent = getAgent(db, s.id);
    return agent ? [{ ...agent, lastActiveAt: s.lastActiveAt }] : [];
  });
  return { resume: agents, kept };
}

/** What the renderer did with the ones it resumed */
export function logAutoResume(outcomes: AutoResumeOutcome[], totalMs: number): void {
  const count = (o: AutoResumeOutcome["outcome"]) => outcomes.filter((x) => x.outcome === o).length;
  for (const o of outcomes) {
    logger.info(
      `[AutoResume] ${o.id} ${o.cliType} -> ${o.outcome}${o.reason ? ` (${o.reason})` : ""}`,
    );
  }
  logger.info(
    `[AutoResume] done in ${totalMs}ms: ${count("resumed")} resumed, ${count("failed")} failed, ${count("skipped")} skipped, ${keptCount} kept suspended`,
  );
}
