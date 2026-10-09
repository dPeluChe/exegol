// Pure parts of the sidecar health watch: stall detection, ping backoff, log rate limits.
import type { ProcessMetrics } from "../system/process-metrics";

/** Calls pending with no answer this long start the pings */
export const STALL_AFTER_MS = 3_000;
/** First ping right away, then these gaps; the last one repeats */
export const PING_BACKOFF_MS = [2_000, 5_000, 10_000] as const;
export const PING_TIMEOUT_MS = 2_000;
/** A ping timer this late means main itself was blocked: that timeout says nothing */
export const LATE_TIMER_MS = 250;
/** Consecutive failed pings before "not answering", and good ones before it clears */
export const PINGS_TO_ANNOUNCE = 2;
export const PINGS_TO_RECOVER = 2;
/** While still stalled, the "not answering" line repeats at most this often */
export const STILL_STALLED_LOG_MS = 60_000;
/** Main's event loop blocked longer than this is logged */
export const LOOP_LAG_MS = 1_000;
export const LOOP_SAMPLE_MS = 5_000;
/** One failure line per RPC method per stall, and at most this often */
export const FAILURE_LOG_MS = 60_000;

export function pingDelay(attempt: number): number {
  return PING_BACKOFF_MS[Math.min(attempt, PING_BACKOFF_MS.length - 1)] as number;
}

export type PingResult = "ok" | "failed" | "unknown";

/** A timed-out ping whose timer fired late ran behind main's own block: unknown, not failed */
export function pingResult(answered: boolean, timerLateMs: number): PingResult {
  if (answered) return "ok";
  return timerLateMs > LATE_TIMER_MS ? "unknown" : "failed";
}

/** Every keystroke passes here: a counter and the last answer's time, no per-call state */
export class CallTracker {
  inFlight = 0;
  private progressAt = 0;

  start(now: number): void {
    if (this.inFlight++ === 0) this.progressAt = now;
  }

  settle(answered: boolean, now: number): void {
    if (this.inFlight > 0) this.inFlight--;
    if (answered) this.progressAt = now;
  }

  /** Retry: the new socket answered, so the wait restarts from now */
  answered(now: number): void {
    this.progressAt = now;
  }

  /** When the wait began once calls are pending and nothing answered for STALL_AFTER_MS */
  stalledSince(now: number): number | null {
    return this.inFlight > 0 && now - this.progressAt >= STALL_AFTER_MS ? this.progressAt : null;
  }

  /** Time left until stalledSince could answer */
  untilStall(now: number): number {
    return Math.max(0, STALL_AFTER_MS - (now - this.progressAt));
  }
}

export type StallEvent =
  | { kind: "stalled"; forMs: number }
  | { kind: "still"; forMs: number }
  | { kind: "recovered"; afterMs: number };

/** Suspect → ping with backoff → announce after PINGS_TO_ANNOUNCE failures in a row → clear
 *  after PINGS_TO_RECOVER answers in a row, so the banner does not flap */
export class StallWatch {
  private since: number | null = null;
  private attempt = 0;
  private failures = 0;
  private answers = 0;
  private announced = false;
  private lastLog = 0;

  get watching(): boolean {
    return this.since !== null;
  }

  get stalledSince(): number | null {
    return this.announced ? this.since : null;
  }

  /** A slow or failed call: true when the pings should start (not already watching) */
  suspect(startedAt: number): boolean {
    if (this.since !== null) return false;
    this.since = startedAt;
    this.attempt = 0;
    this.failures = 0;
    this.answers = 0;
    return true;
  }

  /** Stop watching (Retry got an answer): the recovery to report, if a stall was announced */
  clear(now: number): StallEvent | null {
    const event: StallEvent | null =
      this.announced && this.since !== null
        ? { kind: "recovered", afterMs: now - this.since }
        : null;
    this.since = null;
    this.announced = false;
    return event;
  }

  /** What to report, and when to ping next (null: stop pinging) */
  onPing(result: PingResult, now: number): { event: StallEvent | null; next: number | null } {
    if (this.since === null) return { event: null, next: null };
    if (result === "unknown") return { event: null, next: pingDelay(0) };
    if (result === "ok") {
      this.failures = 0;
      if (this.announced && ++this.answers < PINGS_TO_RECOVER) {
        return { event: null, next: pingDelay(0) };
      }
      return { event: this.clear(now), next: null };
    }
    this.answers = 0;
    const forMs = now - this.since;
    const next = pingDelay(this.attempt++);
    if (!this.announced) {
      if (++this.failures < PINGS_TO_ANNOUNCE) return { event: null, next };
      this.announced = true;
      this.lastLog = now;
      return { event: { kind: "stalled", forMs }, next };
    }
    if (now - this.lastLog >= STILL_STALLED_LOG_MS) {
      this.lastLog = now;
      return { event: { kind: "still", forMs }, next };
    }
    return { event: null, next };
  }
}

export class RateLimiter {
  private last = new Map<string, number>();

  constructor(private readonly intervalMs: number) {}

  allow(key: string, now: number): boolean {
    const prev = this.last.get(key);
    if (prev !== undefined && now - prev < this.intervalMs) return false;
    this.last.set(key, now);
    return true;
  }

  reset(): void {
    this.last.clear();
  }
}

export const seconds = (ms: number): string => `${(ms / 1000).toFixed(1)}s`;

export function describeProcess(m: ProcessMetrics): string {
  return `${m.cpu.toFixed(1)}% CPU, ${Math.round(m.memory / 1024 / 1024)} MB RSS`;
}
