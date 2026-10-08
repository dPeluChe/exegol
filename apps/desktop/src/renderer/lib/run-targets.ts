interface Target {
  rel: string;
  scripts: { command: string }[];
}

/** Past this many folders the Run-in chips get a filter and fold behind "+N more" */
export const RUN_IN_FILTER_AT = 12;
export const RUN_IN_COLLAPSED = 8;

export const runTargetLabel = (t: { rel: string }) => t.rel || "root";

/** The chosen folder while it still exists, else one holding a pin, the root with commands, the first repo */
export function pickRunTarget<T extends Target>(
  targets: T[],
  chosen: string | null,
  pinnedRel: string | undefined,
): T | undefined {
  return (
    targets.find((t) => t.rel === chosen) ??
    targets.find((t) => t.rel === pinnedRel) ??
    targets.find((t) => t.rel !== "" || t.scripts.length > 0) ??
    targets[0]
  );
}

export function visibleRunTargets<T extends Target>(
  targets: T[],
  opts: { query: string; expanded: boolean; selectedRel: string | undefined },
): { shown: T[]; hidden: number; filterable: boolean } {
  const filterable = targets.length > RUN_IN_FILTER_AT;
  const query = opts.query.trim().toLowerCase();
  if (filterable && query) {
    return {
      shown: targets.filter((t) => runTargetLabel(t).toLowerCase().includes(query)),
      hidden: 0,
      filterable,
    };
  }
  if (!filterable || opts.expanded) return { shown: targets, hidden: 0, filterable };
  const shown = targets.slice(0, RUN_IN_COLLAPSED);
  const selected = targets.find((t) => t.rel === opts.selectedRel);
  if (selected && !shown.includes(selected)) shown.push(selected);
  return { shown, hidden: targets.length - shown.length, filterable };
}
