import type { Agent } from "@exegol/shared";
import type Database from "libsql";
import { listAgentsByIds, listProjects, suspendStoppedAgents } from "../db/queries";
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

/** The recent lost sessions go back to the renderer to resume; the rest are kept suspended */
export function planLostResume(
  db: Database.Database,
  lost: LostSession[],
  now = Date.now(),
  pinned: ReadonlySet<string> = new Set(),
): { resume: Array<Agent & { lastActiveAt: number }>; kept: KeptSession[] } {
  const { resume, keep } = splitLost(lost, now, undefined, pinned);
  const byId = new Map(
    listAgentsByIds(
      db,
      [...keep, ...resume].map((s) => s.id),
    ).map((a) => [a.id, a]),
  );
  const projectNames =
    keep.length > 0 ? new Map(listProjects(db).map((p) => [p.id, p.name])) : new Map();
  const kept: KeptSession[] = [];
  for (const s of keep) {
    const agent = byId.get(s.id);
    if (!agent) continue;
    logger.info(
      `[AutoResume] ${s.id} ${agent.cliType} -> kept suspended (idle ${idleDays(now - s.lastActiveAt)})`,
    );
    kept.push({
      agentId: s.id,
      projectId: agent.projectId,
      projectName: projectNames.get(agent.projectId) ?? agent.projectId,
      name: agent.alias ?? getProviderRegistry().get(agent.cliType)?.name ?? agent.cliType,
      cliType: agent.cliType,
    });
  }
  suspendStoppedAgents(
    db,
    kept.map((k) => k.agentId),
    KEPT_STEP,
    Math.floor(now / 1000),
  );
  settleLost(keep.map((s) => s.id));
  const agents = resume.flatMap((s) => {
    const agent = byId.get(s.id);
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
  const noPane = outcomes.filter((o) => o.reason === NO_PANE).map((o) => o.id);
  suspendStoppedAgents(db, noPane, NO_PANE_STEP, Math.floor(now / 1000), "crashed");
  for (const o of outcomes) {
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
