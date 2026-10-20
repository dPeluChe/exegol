/** How long after a mount a grid change still counts as the layout settling */
export const SETTLE_WINDOW_MS = 2_000;

export interface SettleReport {
  kind: "settle";
  mountGrid: string;
  finalGrid: string;
  afterMs: number;
  changes: number;
}

/** Grids a view fits to after its mount line; a report only when one differed */
export function createSettleTracker(mountGrid: string, now: () => number) {
  const start = now();
  let last = mountGrid;
  let lastAt = start;
  let changes = 0;
  return {
    fit(grid: string): void {
      if (grid === last) return;
      last = grid;
      lastAt = now();
      changes++;
    },
    report(): SettleReport | null {
      if (changes === 0) return null;
      return { kind: "settle", mountGrid, finalGrid: last, afterMs: lastAt - start, changes };
    },
  };
}
