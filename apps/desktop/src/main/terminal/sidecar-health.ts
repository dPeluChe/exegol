// Pure parts of the sidecar health watch: stall detection, ping backoff, log rate limits.

/** A write/resize/kill unanswered this long starts the pings */
export const STALL_AFTER_MS = 3_000;
/** First ping right away, then these gaps; the last one repeats */
export const PING_BACKOFF_MS = [2_000, 5_000, 10_000] as const;
export const PING_TIMEOUT_MS = 2_000;
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

/** The oldest call's start once it has waited STALL_AFTER_MS, else null */
export function stalledCall(startedAt: Iterable<number>, now: number): number | null {
  let oldest = Number.POSITIVE_INFINITY;
  for (const t of startedAt) oldest = Math.min(oldest, t);
  return now - oldest >= STALL_AFTER_MS ? oldest : null;
}

export type StallEvent =
  | { kind: "stalled"; forMs: number }
  | { kind: "still"; forMs: number }
  | { kind: "recovered"; afterMs: number };

/** Suspect → ping with backoff → announce the stall on the first unanswered ping → recover */
export class StallWatch {
  private since: number | null = null;
  private attempt = 0;
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
    return true;
  }

  /** What to report, and when to ping next (null: stop pinging) */
  onPing(ok: boolean, now: number): { event: StallEvent | null; next: number | null } {
    if (this.since === null) return { event: null, next: null };
    const forMs = now - this.since;
    if (ok) {
      const event: StallEvent | null = this.announced
        ? { kind: "recovered", afterMs: forMs }
        : null;
      this.since = null;
      this.announced = false;
      return { event, next: null };
    }
    const next = pingDelay(this.attempt++);
    if (!this.announced) {
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

/** `ps -o pcpu=,rss=` output → "12.5% CPU, 340 MB RSS" */
export function describeProcess(psLine: string): string | null {
  const [cpu, rss] = psLine.trim().split(/\s+/);
  const cpuN = Number.parseFloat(cpu ?? "");
  const rssKb = Number.parseInt(rss ?? "", 10);
  if (!Number.isFinite(cpuN) || !Number.isFinite(rssKb)) return null;
  return `${cpuN.toFixed(1)}% CPU, ${Math.round(rssKb / 1024)} MB RSS`;
}
