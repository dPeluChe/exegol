import type Database from "libsql";
import { sendSystemMessage } from "../../agents/agent-messaging";
import { getDb } from "../../db/client";
import { isAgentQuiet, listPrWatchedAgents } from "../../db/queries/agents";
import { detectGhCli, execFileAsync } from "../../ipc/procedures/diff-helpers";
import { broadcast } from "../../lib/event-bus";
import { logger } from "../../lib/logger";
import { AsyncLruCache } from "../../lib/lru-cache";
import { getNotificationBus } from "../../notifications/bus";
import {
  computeReactions,
  newWatchState,
  type PrReaction,
  type PrSnapshot,
  type PrWatchState,
  parsePrSnapshot,
} from "./pr-watch-reactions";

const TICK_MS = 60_000;
// Slow on purpose: gh hits the network and the GitHub rate limit
const POLL_MS = 3 * 60_000;
const GH_TIMEOUT_MS = 15_000;
const SOURCE = "PR watch";

export interface PrWatchStatus {
  pr: {
    number: number;
    url: string;
    failingChecks: number;
    conflicting: boolean;
  } | null;
  lastPolledAt: number | null;
}

interface Watched {
  state: PrWatchState;
  lastPolledAt: number | null;
  pr: PrSnapshot | null;
}

const watched = new Map<string, Watched>();
// Two agents in one folder share one PR: one gh round per folder per poll
const snapshots = new AsyncLruCache<string, PrSnapshot | null>(16, POLL_MS - 10_000);
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

async function fetchSnapshot(cwd: string): Promise<PrSnapshot | null> {
  const branch = await execFileAsync("git", ["branch", "--show-current"], { cwd })
    .then(({ stdout }) => stdout.trim())
    .catch(() => "");
  if (!branch || branch === "main" || branch === "master") return null;
  let view: string;
  try {
    ({ stdout: view } = await execFileAsync(
      "gh",
      [
        "pr",
        "view",
        "--json",
        "number,url,state,headRefOid,mergeable,mergeStateStatus,statusCheckRollup,reviews,comments",
      ],
      { cwd, timeout: GH_TIMEOUT_MS, maxBuffer: 4 * 1024 * 1024 },
    ));
  } catch {
    return null; // no PR for this branch
  }
  const number = parsePrSnapshot(view, null)?.number;
  if (!number) return null;
  // Line comments are not in `gh pr view`; gh fills {owner}/{repo} from the cwd
  const inline = await execFileAsync(
    "gh",
    ["api", `repos/{owner}/{repo}/pulls/${number}/comments?per_page=100`],
    { cwd, timeout: GH_TIMEOUT_MS, maxBuffer: 4 * 1024 * 1024 },
  )
    .then(({ stdout }) => stdout)
    .catch(() => null);
  return parsePrSnapshot(view, inline);
}

function deliver(
  db: Database.Database,
  agent: { id: string; projectId: string },
  reactions: PrReaction[],
): void {
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
  agent: { id: string; projectId: string; cwd: string },
  entry: Watched,
): Promise<void> {
  entry.lastPolledAt = Date.now();
  const pr = await snapshots.getOrCompute(agent.cwd, () => fetchSnapshot(agent.cwd));
  entry.pr = pr?.state === "OPEN" ? pr : null;
  if (!entry.pr) return;
  const reactions = computeReactions(entry.state, entry.pr, await ghSelfLogin());
  if (reactions.length > 0) deliver(db, agent, reactions);
}

async function tick(): Promise<void> {
  if (ticking) return;
  ticking = true;
  try {
    const db = getDb();
    const agents = listPrWatchedAgents(db);
    const live = new Set(agents.map((a) => a.id));
    for (const id of watched.keys()) if (!live.has(id)) watched.delete(id);
    if (agents.length === 0 || !(await detectGhCli())) return;
    const now = Date.now();
    for (const agent of agents) {
      let entry = watched.get(agent.id);
      if (!entry) {
        entry = { state: newWatchState(now), lastPolledAt: null, pr: null };
        watched.set(agent.id, entry);
      }
      if (entry.lastPolledAt !== null && now - entry.lastPolledAt < POLL_MS) continue;
      await pollAgent(db, agent, entry).catch((err) =>
        logger.warn(`[PrWatch] poll failed for ${agent.id}:`, err),
      );
    }
  } catch (err) {
    logger.warn("[PrWatch] tick failed:", err);
  } finally {
    ticking = false;
  }
}

export function startPrWatch(): void {
  if (timer) return;
  timer = setInterval(() => void tick(), TICK_MS);
  timer.unref?.();
}

export function stopPrWatch(): void {
  if (timer) clearInterval(timer);
  timer = null;
}

/** Toggled on: start fresh (new baseline, caps reset) and poll now, not in a minute */
export function onPrWatchToggled(agentId: string, on: boolean): void {
  watched.delete(agentId);
  if (on) void tick();
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
