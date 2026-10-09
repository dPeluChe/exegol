// Sidecar health watch: calls left unanswered start pings with backoff, a stall is logged (with
// the sidecar's CPU and RSS) and pushed on `sidecar:health`. Main's own event-loop lag is logged
// too, to tell a stuck main from a stuck sidecar.
import { monitorEventLoopDelay } from "node:perf_hooks";
import { SIDECAR_HEALTHY, type SidecarHealth } from "@exegol/shared";
import { broadcast } from "../lib/event-bus";
import { logger } from "../lib/logger";
import { withTimeout } from "../lib/timeout";
import { readProcessMetrics } from "../system/process-metrics";
import type { SidecarClient } from "./pty-sidecar-client";
import { readPidFile } from "./pty-sidecar-discovery";
import {
  CallTracker,
  describeProcess,
  FAILURE_LOG_MS,
  LOOP_LAG_MS,
  LOOP_SAMPLE_MS,
  PING_TIMEOUT_MS,
  type PingResult,
  pingResult,
  RateLimiter,
  STALL_AFTER_MS,
  type StallEvent,
  StallWatch,
  seconds,
} from "./sidecar-health";

let clientSource: (() => SidecarClient | null) | null = null;
const watch = new StallWatch();
const calls = new CallTracker();
const failureLog = new RateLimiter(FAILURE_LOG_MS);
let lastLoopLog = 0;
/** Snapshot replies are megabytes: calls queued behind one are slow, not stalled */
let bulkInFlight = 0;
let checkTimer: ReturnType<typeof setTimeout> | null = null;
let pingTimer: ReturnType<typeof setTimeout> | null = null;
let loopTimer: ReturnType<typeof setInterval> | null = null;
let loopMonitor: ReturnType<typeof monitorEventLoopDelay> | null = null;
let health: SidecarHealth = SIDECAR_HEALTHY;

export function getSidecarHealth(): SidecarHealth {
  return health;
}

function setHealth(next: SidecarHealth): void {
  health = next;
  broadcast("sidecar:health", next);
}

const onCallAnswered = (): void => calls.settle(true, Date.now());

/** A sidecar RPC from PtyHost. A rejection from a client Retry already replaced is no new stall */
export function trackSidecarCall(
  method: string,
  sessionId: string,
  call: Promise<unknown>,
  client: SidecarClient,
): void {
  const started = Date.now();
  calls.start(started);
  scheduleCheck(STALL_AFTER_MS);
  call.then(onCallAnswered, (err: unknown) => {
    const now = Date.now();
    calls.settle(false, now);
    if (clientSource?.() !== client) return;
    if (failureLog.allow(method, now)) {
      const reason = err instanceof Error && /timeout/i.test(err.message) ? "timed out" : "failed";
      const detail = err instanceof Error && reason === "failed" ? ` (${err.message})` : "";
      logger.warn(
        `[Sidecar] ${method} to ${sessionId} ${reason} after ${seconds(now - started)}${detail}`,
      );
    }
    suspect(started);
  });
}

/** A snapshot RPC: no stall is suspected while one is in flight */
export async function whileSidecarBulk<T>(call: Promise<T>): Promise<T> {
  bulkInFlight++;
  try {
    return await call;
  } finally {
    bulkInFlight--;
  }
}

function scheduleCheck(ms: number): void {
  if (checkTimer || !clientSource) return;
  checkTimer = setTimeout(() => {
    checkTimer = null;
    if (calls.inFlight === 0) return;
    const now = Date.now();
    const since = calls.stalledSince(now);
    if (since !== null) suspect(since);
    else scheduleCheck(calls.untilStall(now));
  }, ms);
  checkTimer.unref?.();
}

function suspect(startedAt: number): void {
  if (!clientSource) return;
  if (bulkInFlight > 0) {
    scheduleCheck(STALL_AFTER_MS);
    return;
  }
  if (watch.suspect(startedAt)) void ping();
}

async function ping(): Promise<void> {
  pingTimer = null;
  const client = clientSource?.();
  let result: PingResult = "failed";
  if (client?.isConnected()) {
    const sent = performance.now();
    const answered = await withTimeout(client.ping(), PING_TIMEOUT_MS, "ping").then(
      () => true,
      () => false,
    );
    result = pingResult(answered, performance.now() - sent - PING_TIMEOUT_MS);
  }
  onPingResult(result, Date.now());
}

function onPingResult(result: PingResult, now: number): void {
  const { event, next } = watch.onPing(result, now);
  if (event) void report(event);
  if (next !== null) {
    pingTimer = setTimeout(() => void ping(), next);
    pingTimer.unref?.();
  }
}

async function report(event: StallEvent): Promise<void> {
  if (event.kind === "recovered") {
    failureLog.reset();
    logger.info(`[Sidecar] answering again after ${seconds(event.afterMs)}`);
    setHealth(SIDECAR_HEALTHY);
    return;
  }
  if (event.kind === "stalled") setHealth({ stalled: true, since: watch.stalledSince });
  logger.warn(`[Sidecar] not answering for ${seconds(event.forMs)} (${await processInfo()})`);
}

async function processInfo(): Promise<string> {
  const pid = readPidFile()?.pid;
  if (!pid) return "no pid file";
  const metrics = await readProcessMetrics([pid]).then(
    (m) => m.get(pid),
    () => undefined,
  );
  return metrics ? `pid ${pid}, ${describeProcess(metrics)}` : `pid ${pid}, process gone`;
}

/** Retry swapped in a fresh client that answered a ping: clear at once, no second ping */
export function markSidecarAnswering(): void {
  if (pingTimer) clearTimeout(pingTimer);
  pingTimer = null;
  const now = Date.now();
  calls.answered(now);
  const event = watch.clear(now);
  if (event) void report(event);
}

export function startSidecarHealthWatch(source: () => SidecarClient | null): void {
  clientSource = source;
  const loop = monitorEventLoopDelay({ resolution: 50 });
  loop.enable();
  loopMonitor = loop;
  loopTimer = setInterval(() => {
    const maxMs = loop.max / 1e6;
    loop.reset();
    const now = Date.now();
    if (maxMs > LOOP_LAG_MS && now - lastLoopLog >= FAILURE_LOG_MS) {
      lastLoopLog = now;
      logger.warn(`[Main] event loop blocked for ${seconds(maxMs)}`);
    }
  }, LOOP_SAMPLE_MS);
  loopTimer.unref?.();
}

export function stopSidecarHealthWatch(): void {
  clientSource = null;
  for (const t of [checkTimer, pingTimer]) if (t) clearTimeout(t);
  if (loopTimer) clearInterval(loopTimer);
  loopMonitor?.disable();
  loopMonitor = null;
  checkTimer = pingTimer = loopTimer = null;
}
