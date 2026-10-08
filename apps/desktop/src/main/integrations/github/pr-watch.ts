import type { PrWatchStatus } from "@exegol/shared";
import type Database from "libsql";
import { sendSystemMessage } from "../../agents/agent-messaging";
import { getDb } from "../../db/client";
import {
  advancePrWatchCursor,
  isAgentQuiet,
  listPrWatchedAgents,
  type PrWatchedAgent,
} from "../../db/queries/agents";
import { broadcast } from "../../lib/event-bus";
import { execFileAsync } from "../../lib/exec-file";
import { logger } from "../../lib/logger";
import { getNotificationBus } from "../../notifications/bus";
import { currentBranch, detectGhCli, isDefaultBranch } from "./gh";
import {
  computeReactions,
  MAX_WAKES,
  newWatchState,
  type PrReaction,
  type PrSnapshot,
  type PrWatchState,
  parseInlineFeedback,
  parsePrSnapshot,
} from "./pr-watch-reactions";

// Slow on purpose: gh hits the network and the GitHub rate limit
const POLL_MS = 3 * 60_000;
const NO_PR_BACKOFF_MS = 15 * 60_000;
const GH_TIMEOUT_MS = 15_000;
const GH_MAX_BUFFER = 4 * 1024 * 1024;
const SOURCE = "PR watch";

interface Watched {
  state: PrWatchState;
  lastPolledAt: number | null;
  pr: PrSnapshot | null;
  /** No PR for the branch yet: next look not before this */
  retryAt: number;
  /** Merged or closed: nothing left to watch */
  done: boolean;
}

const watched = new Map<string, Watched>();
let timer: ReturnType<typeof setInterval> | null = null;
let ticking = false;
let selfLogin: Promise<string | null> | null = null;

async function ghSelfLogin(): Promise<string | null> {
  selfLogin ??= execFileAsync("gh", ["api", "user", "--jq", ".login"], { timeout: GH_TIMEOUT_MS })
    .then(({ stdout }) => stdout.trim() || null)
    .catch(() => {
      selfLogin = null; // offline now is not offline forever
      return null;
    });
  return selfLogin;
}

async function fetchSnapshot(cwd: string, defaultBranch: string): Promise<PrSnapshot | null> {
  const branch = await currentBranch(cwd);
  if (!branch || isDefaultBranch(branch, defaultBranch)) return null;
  const pr = await execFileAsync(
    "gh",
    [
      "pr",
      "view",
      "--json",
      "number,url,state,headRefOid,mergeable,mergeStateStatus,statusCheckRollup,reviews,comments",
    ],
    { cwd, timeout: GH_TIMEOUT_MS, maxBuffer: GH_MAX_BUFFER },
  )
    .then(({ stdout }) => parsePrSnapshot(stdout))
    .catch(() => null); // no PR for this branch
  if (pr?.state !== "OPEN") return pr;
  // gh fills {owner}/{repo} from the cwd
  const inline = await execFileAsync(
    "gh",
    ["api", `repos/{owner}/{repo}/pulls/${pr.number}/comments?per_page=100`],
    { cwd, timeout: GH_TIMEOUT_MS, maxBuffer: GH_MAX_BUFFER },
  )
    .then(({ stdout }) => parseInlineFeedback(stdout))
    .catch(() => []);
  pr.feedback.push(...inline);
  return pr;
}

function deliver(db: Database.Database, agent: PrWatchedAgent, reactions: PrReaction[]): void {
  const quiet = isAgentQuiet(db, agent.id);
  for (const r of reactions) {
    const sent = sendSystemMessage(db, { toAgentId: agent.id, source: SOURCE, text: r.text });
    logger.info(
      `[PrWatch] ${agent.id}: ${r.kind} ${sent ? (sent.delivered ? "delivered" : "queued") : "dropped"}`,
    );
    if (!sent || quiet) continue;
    getNotificationBus().emit({
      type: "agent:attention",
      title: r.summary,
      body: "Sent to the agent at its next turn boundary",
      agentId: agent.id,
      projectId: agent.projectId,
      at: Date.now(),
    });
    broadcast("agent:pr-watch", {
      agentId: agent.id,
      projectId: agent.projectId,
      reason: r.summary,
    });
  }
}

async function pollAgent(
  db: Database.Database,
  agent: PrWatchedAgent,
  entry: Watched,
  pr: PrSnapshot | null,
): Promise<void> {
  const now = Date.now();
  entry.lastPolledAt = now;
  entry.pr = pr?.state === "OPEN" ? pr : null;
  if (!pr) entry.retryAt = now + NO_PR_BACKOFF_MS;
  else if (!entry.pr) entry.done = true;
  if (entry.pr) {
    const reactions = computeReactions(entry.state, entry.pr, await ghSelfLogin());
    if (reactions.length > 0) deliver(db, agent, reactions);
    // Persisted so feedback posted while the app is closed still counts as news after a restart
    const newest = Math.max(0, ...entry.pr.feedback.map((f) => f.at));
    if (newest >= agent.since) advancePrWatchCursor(db, agent.id, newest + 1);
  }
  broadcast("agent:pr-watch", { agentId: agent.id, projectId: agent.projectId });
}

async function tick(only?: string): Promise<void> {
  if (ticking) return;
  ticking = true;
  try {
    const db = getDb();
    const agents = listPrWatchedAgents(db);
    const live = new Set(agents.map((a) => a.id));
    for (const id of watched.keys()) if (!live.has(id)) watched.delete(id);
    if (agents.length === 0 || !(await detectGhCli())) return;
    const now = Date.now();
    // Two agents in one folder share one PR: one gh round per folder per tick
    const byCwd = new Map<string, Promise<PrSnapshot | null>>();
    for (const agent of agents) {
      if (only && agent.id !== only) continue;
      const entry = watched.get(agent.id) ?? {
        state: newWatchState(agent.since),
        lastPolledAt: null,
        pr: null,
        retryAt: 0,
        done: false,
      };
      watched.set(agent.id, entry);
      if (entry.done || entry.state.wakes >= MAX_WAKES || now < entry.retryAt) continue;
      let snapshot = byCwd.get(agent.cwd);
      if (!snapshot) {
        snapshot = fetchSnapshot(agent.cwd, agent.defaultBranch);
        byCwd.set(agent.cwd, snapshot);
      }
      await snapshot
        .then((pr) => pollAgent(db, agent, entry, pr))
        .catch((err) => logger.warn(`[PrWatch] poll failed for ${agent.id}:`, err));
    }
  } catch (err) {
    logger.warn("[PrWatch] tick failed:", err);
  } finally {
    ticking = false;
  }
}

export function startPrWatch(): void {
  if (timer) return;
  timer = setInterval(() => void tick(), POLL_MS);
  timer.unref?.();
}

export function stopPrWatch(): void {
  if (timer) clearInterval(timer);
  timer = null;
}

/** Toggled on: start fresh (caps reset) and poll it now, not at the next interval */
export function onPrWatchToggled(agentId: string, on: boolean): void {
  watched.delete(agentId);
  if (on) void tick(agentId);
}

export function getPrWatchStatus(agentId: string): PrWatchStatus {
  const entry = watched.get(agentId);
  const pr = entry?.pr;
  return {
    pr: pr
      ? {
          number: pr.number,
          url: pr.url,
          failingChecks: pr.failingChecks.length,
          conflicting: pr.conflicting,
        }
      : null,
    lastPolledAt: entry?.lastPolledAt ?? null,
  };
}
