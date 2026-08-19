import { cn } from "@exegol/ui";

/** A 0-1 agent score as a percentage badge. Shared so the same number does not
 *  read two ways in two tabs (Scoring showed a badge, History a raw decimal). */
export function ScoreBadge({ score }: { score: number }) {
  const pct = Math.round(score * 100);
  const color =
    pct >= 70
      ? "bg-green-500/20 text-green-400"
      : pct >= 40
        ? "bg-yellow-500/20 text-yellow-400"
        : "bg-red-500/20 text-red-400";

  return (
    <span className={cn("rounded px-1.5 py-0.5 text-[11px] font-bold tabular-nums", color)}>
      {pct}%
    </span>
  );
}
