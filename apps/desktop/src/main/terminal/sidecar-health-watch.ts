// Sidecar health watch: an unanswered write/resize/kill starts pings with backoff, a stall is
// logged (with the sidecar's CPU and RSS) and pushed on `sidecar:health`. Main's own event-loop
// lag is logged too, to tell a stuck main from a stuck sidecar.
import { execFile } from "node:child_process";
import { monitorEventLoopDelay } from "node:perf_hooks";
import { promisify } from "node:util";
import { SIDECAR_HEALTHY, type SidecarHealth } from "@exegol/shared";
import { broadcast } from "../lib/event-bus";
import { logger } from "../lib/logger";
import type { SidecarClient } from "./pty-sidecar-client";
import { readPidFile } from "./pty-sidecar-discovery";
import {
  describeProcess,
  FAILURE_LOG_MS,
  LOOP_LAG_MS,
  LOOP_SAMPLE_MS,
  PING_TIMEOUT_MS,
  RateLimiter,
  STALL_AFTER_MS,
  type StallEvent,
  StallWatch,
  seconds,
  stalledCall,
} from "./sidecar-health";

const execFileAsync = promisify(execFile);

let clientSource: (() => SidecarClient | null) | null = null;
const watch = new StallWatch();
const failureLog = new RateLimiter(FAILURE_LOG_MS);
const loopLog = new RateLimiter(FAILURE_LOG_MS);
const outstanding = new Map<number, number>();
let seq = 0;
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

/** A sidecar RPC from PtyHost. `current`: false once Retry replaced that client, so its
 *  rejected calls are not a new stall */
export function trackSidecarCall(
  method: string,
  sessionId: string,
  call: Promise<unknown>,
  current: () => boolean,
): void {
  const token = ++seq;
  const started = Date.now();
  outstanding.set(token, started);
  scheduleCheck(STALL_AFTER_MS);
  call.then(
    () => outstanding.delete(token),
    (err: unknown) => {
      outstanding.delete(token);
      if (!current()) return;
      const now = Date.now();
      if (failureLog.allow(method, now)) {
        const reason =
          err instanceof Error && /timeout/i.test(err.message) ? "timed out" : "failed";
        const detail = err instanceof Error && reason === "failed" ? ` (${err.message})` : "";
        logger.warn(
          `[Sidecar] ${method} to ${sessionId} ${reason} after ${seconds(now - started)}${detail}`,
        );
      }
      suspect(started);
    },
  );
}

function scheduleCheck(ms: number): void {
  if (checkTimer || !clientSource) return;
  checkTimer = setTimeout(() => {
    checkTimer = null;
    if (outstanding.size === 0) return;
    const now = Date.now();
    const stalled = stalledCall(outstanding.values(), now);
    if (stalled !== null) suspect(stalled);
    else scheduleCheck(STALL_AFTER_MS - (now - Math.min(...outstanding.values())));
  }, ms);
  checkTimer.unref?.();
}

function suspect(startedAt: number): void {
  if (!clientSource || !watch.suspect(startedAt)) return;
  void ping();
}

async function ping(): Promise<void> {
  pingTimer = null;
  const client = clientSource?.();
  let ok = false;
  if (client?.isConnected()) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const expired = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("ping timed out")), PING_TIMEOUT_MS);
    });
    ok = await Promise.race([client.ping(), expired]).then(
      () => true,
      () => false,
    );
    clearTimeout(timer);
  }
  onPingResult(ok, Date.now());
}

function onPingResult(ok: boolean, now: number): void {
  const { event, next } = watch.onPing(ok, now);
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
  try {
    const { stdout } = await execFileAsync("ps", ["-o", "pcpu=,rss=", "-p", String(pid)], {
      timeout: 3_000,
    });
    return `pid ${pid}, ${describeProcess(stdout) ?? "no stats"}`;
  } catch {
    return `pid ${pid}, process gone`;
  }
}

/** Retry swapped in a fresh client that answered a ping */
export function markSidecarAnswering(): void {
  outstanding.clear();
  if (pingTimer) clearTimeout(pingTimer);
  pingTimer = null;
  onPingResult(true, Date.now());
}

export function startSidecarHealthWatch(source: () => SidecarClient | null): void {
  clientSource = source;
  const loop = monitorEventLoopDelay({ resolution: 50 });
  loop.enable();
  loopMonitor = loop;
  loopTimer = setInterval(() => {
    const maxMs = loop.max / 1e6;
    loop.reset();
    if (maxMs > LOOP_LAG_MS && loopLog.allow("loop", Date.now())) {
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
