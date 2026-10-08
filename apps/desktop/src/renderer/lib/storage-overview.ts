import type { StorageCategory, StorageOtherEntry, StorageRow } from "@exegol/shared";

export interface BarSegment {
  category: StorageCategory;
  label: string;
  bytes: number;
  percent: number;
}

/** Non-empty rows as shares of their sum, rounded to 0.1 with the remainder on the largest */
export function storageBarSegments(rows: readonly StorageRow[]): BarSegment[] {
  const used = rows.filter((r) => r.bytes > 0);
  const total = used.reduce((a, r) => a + r.bytes, 0);
  if (total === 0) return [];
  const segments = used.map((r) => ({
    category: r.category,
    label: r.label,
    bytes: r.bytes,
    percent: Math.round((r.bytes / total) * 1000) / 10,
  }));
  const largest = segments.reduce((a, b) => (b.bytes > a.bytes ? b : a));
  const drift = 100 - segments.reduce((a, s) => a + s.percent, 0);
  largest.percent = Math.round((largest.percent + drift) * 10) / 10;
  return segments;
}

export interface OtherSummary {
  top: StorageOtherEntry[];
  restCount: number;
  restBytes: number;
}

/** The first `limit` entries (main sends them largest first), the rest folded into one count and size */
export function summarizeOther(entries: readonly StorageOtherEntry[], limit: number): OtherSummary {
  const rest = entries.slice(limit);
  return {
    top: entries.slice(0, limit),
    restCount: rest.length,
    restBytes: rest.reduce((a, e) => a + e.bytes, 0),
  };
}
