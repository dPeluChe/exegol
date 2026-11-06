import { hostOf } from "@exegol/shared";
import type Database from "libsql";
import { ExegolToolError } from "../mcp/exegol-protocol";
import {
  clearWaiting,
  getPaneControl,
  startWaiting,
  type WakeReason,
  waitForHandBack,
} from "./control";
import {
  aliasOf,
  type BrowserToolContext,
  logAction,
  notifyNeedsUser,
  pageSummary,
  requireHost,
  resolvePane,
  settle,
} from "./tool-guards";

const WAIT_POLL_MS = 25_000;
/** A wait not polled for this long was abandoned (the agent moved on): the next call starts over */
const WAIT_STALE_MS = 30_000;
const DEFAULT_WAIT_MIN = 10;
const MAX_WAIT_MIN = 30;

interface OpenWait {
  paneId: string;
  reason: string;
  handBacks: number;
  deadline: number;
  lastPollAt: number;
}

/** Open waits by agent: the hand-back count when each started, so one that landed between two
 *  polls still counts */
const waits = new Map<string, OpenWait>();

/** A wait call continues the open one only when it is the same ask, still in time and still
 *  being polled; anything else starts a fresh wait (and a fresh alert) */
export function isWaitStale(
  wait: OpenWait | undefined,
  call: { paneId: string; reason: string; now: number },
): boolean {
  return (
    !wait ||
    wait.paneId !== call.paneId ||
    wait.reason !== call.reason ||
    call.now >= wait.deadline ||
    call.now - wait.lastPollAt > WAIT_STALE_MS
  );
}

export function clearAgentWaits(agentId: string): void {
  const wait = waits.get(agentId);
  if (!wait) return;
  waits.delete(agentId);
  clearWaiting(wait.paneId);
}

export async function handleWait(
  db: Database.Database,
  ctx: BrowserToolContext,
  args: Record<string, unknown>,
) {
  const reason = String(args.reason ?? "")
    .trim()
    .slice(0, 300);
  if (!reason) throw new ExegolToolError("reason is required: tell the user what to do", -32602);
  const minutes = Math.min(
    Math.max(Number(args.timeout_minutes) || DEFAULT_WAIT_MIN, 1),
    MAX_WAIT_MIN,
  );
  const pane = resolvePane(requireHost().livePanes(ctx.projectId), ctx, args.pane);
  const handBacks = () => getPaneControl(pane.paneId)?.handBacks ?? 0;
  const now = Date.now();

  const startWait = (previous: OpenWait | undefined): OpenWait => {
    if (previous && previous.paneId !== pane.paneId) clearWaiting(previous.paneId);
    const alias = aliasOf(db, ctx.agentId);
    // The pane already raised "needs you" (a login it stopped at): no second alert
    const alreadyAsked = !!getPaneControl(pane.paneId)?.needsUser;
    const started = {
      paneId: pane.paneId,
      reason,
      handBacks: handBacks(),
      deadline: now + minutes * 60_000,
      lastPollAt: now,
    };
    waits.set(ctx.agentId, started);
    startWaiting(pane.paneId, ctx.projectId, { id: ctx.agentId, alias }, reason, started.deadline);
    if (!alreadyAsked) notifyNeedsUser(ctx, alias, reason);
    logAction(db, ctx, {
      tool: "browser_wait_for_user",
      paneId: pane.paneId,
      host: hostOf(pane.getUrl()),
      outcome: "started",
    });
    return started;
  };
  const existing = waits.get(ctx.agentId);
  const current =
    existing && !isWaitStale(existing, { paneId: pane.paneId, reason, now })
      ? existing
      : startWait(existing);
  current.lastPollAt = now;
  const done = async (how: WakeReason) => {
    waits.delete(ctx.agentId);
    if (how === "pane_closed") {
      return {
        status: "pane_closed",
        pane: pane.paneId,
        hint: "The browser pane was closed. Open one with browser_open if you still need it.",
      };
    }
    await settle();
    const summary = await pageSummary(db, ctx, pane).catch(() => ({ status: "ok" }));
    return {
      ...summary,
      status: "handed_back",
      hint: "The user handed the browser back. Call browser_snapshot to see what changed.",
    };
  };
  if (handBacks() > current.handBacks) return done("handed_back");
  const left = current.deadline - now;
  const woke = await waitForHandBack(pane.paneId, Math.min(WAIT_POLL_MS, left));
  if (woke !== "timeout") return done(woke);
  if (handBacks() > current.handBacks) return done("handed_back");
  if (Date.now() >= current.deadline) {
    waits.delete(ctx.agentId);
    clearWaiting(pane.paneId);
    return {
      status: "timed_out",
      pane: pane.paneId,
      hint: "The user did not hand the browser back in time. Tell them in chat what you need, then stop or try again later.",
    };
  }
  return {
    status: "waiting",
    pane: pane.paneId,
    remainingSeconds: Math.round((current.deadline - Date.now()) / 1000),
    hint: "Still waiting for the user. Call browser_wait_for_user again with the same reason.",
  };
}
