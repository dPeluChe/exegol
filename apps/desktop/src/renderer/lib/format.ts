/** Relative time: "now", "5m", "3h", "2d" */
export function formatTimeAgo(unixSeconds: number | null | undefined): string {
  if (!unixSeconds) return "";
  const seconds = Math.floor(Date.now() / 1000) - unixSeconds;
  if (seconds < 60) return "now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  return `${Math.floor(seconds / 86400)}d`;
}

/** Relative time with "ago" suffix: "just now", "5m ago", "3h ago" */
export function formatTimeAgoLong(unixSeconds: number | null | undefined): string {
  if (!unixSeconds) return "";
  const seconds = Math.floor(Date.now() / 1000) - unixSeconds;
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

/** Format token count: 1500 → "1.5k", 1500000 → "1.5M" */
export function formatTokens(count: number): string {
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
  if (count >= 1_000) return `${(count / 1_000).toFixed(1)}k`;
  return String(count);
}

/** Format USD cost: 0.005 → "$0.005", 1.50 → "$1.50" */
export function formatCost(usd: number): string {
  if (usd < 0.01) return usd > 0 ? `$${usd.toFixed(4)}` : "$0.00";
  if (usd < 1) return `$${usd.toFixed(3)}`;
  return `$${usd.toFixed(2)}`;
}
