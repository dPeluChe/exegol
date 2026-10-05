export type BrowserLogLevel = "debug" | "info" | "warning" | "error";

export interface BrowserLogEntry {
  seq: number;
  at: number;
  kind: "console" | "exception" | "network" | "load";
  level: BrowserLogLevel;
  text: string;
  source?: string;
  line?: number;
  status?: number;
  method?: string;
  url?: string;
  /** Host of the page the pane was on when this was logged */
  page?: string;
}

const LEVEL_RANK: Record<BrowserLogLevel, number> = { debug: 0, info: 1, warning: 2, error: 3 };
const MAX_TEXT = 2_000;

export function toLogLevel(raw: unknown): BrowserLogLevel {
  if (raw === "warn" || raw === "warning" || raw === 2) return "warning";
  if (raw === "error" || raw === 3) return "error";
  if (raw === "debug" || raw === "verbose" || raw === 0) return "debug";
  return "info";
}

export function isLogLevel(raw: unknown): raw is BrowserLogLevel {
  return typeof raw === "string" && raw in LEVEL_RANK;
}

/** Bounded per-page log: the oldest entries go first */
export class LogRing {
  private entries: BrowserLogEntry[] = [];
  private seq = 0;

  constructor(private readonly capacity = 500) {}

  push(entry: Omit<BrowserLogEntry, "seq" | "at"> & { at?: number }): void {
    this.seq += 1;
    this.entries.push({
      ...entry,
      text: entry.text.length > MAX_TEXT ? `${entry.text.slice(0, MAX_TEXT)}…` : entry.text,
      seq: this.seq,
      at: entry.at ?? Date.now(),
    });
    if (this.entries.length > this.capacity) {
      this.entries.splice(0, this.entries.length - this.capacity);
    }
  }

  /** `since`: the lastSeq of an earlier call (only newer entries); `level`: that level and up */
  query(opts: { since?: number; level?: BrowserLogLevel; limit?: number } = {}): {
    entries: BrowserLogEntry[];
    lastSeq: number;
    dropped: boolean;
  } {
    const min = LEVEL_RANK[opts.level ?? "debug"];
    const since = opts.since ?? 0;
    const first = this.entries[0]?.seq ?? this.seq + 1;
    const matching = this.entries.filter((e) => e.seq > since && LEVEL_RANK[e.level] >= min);
    const limit = Math.max(1, Math.min(opts.limit ?? 200, this.capacity));
    return {
      entries: matching.slice(-limit),
      lastSeq: this.seq,
      // Entries between `since` and the oldest kept one were evicted
      dropped: since < first - 1 && this.seq > this.capacity,
    };
  }

  get size(): number {
    return this.entries.length;
  }
}
