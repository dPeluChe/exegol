// ─── Time formatting ─────────────────────────────────────────────────────

export function timeAgo(ts: number, now: number): string {
  const diff = Math.floor((now - ts) / 1000);
  if (diff < 60) return `${diff}s`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
  return `${Math.floor(diff / 86400)}d`;
}

export function elapsed(startedAt: number | null, now: number): string {
  if (!startedAt) return "";
  return timeAgo(startedAt * 1000, now);
}
