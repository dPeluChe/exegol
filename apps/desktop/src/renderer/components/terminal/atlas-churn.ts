/** addon-webgl keys each glyph by its colors: output whose truecolors never repeat (gradients,
 *  lolcat, btop graphs) rasterizes every cell again, ~350 ms a frame where the DOM renderer takes
 *  ~25 (docs/RESEARCH/WEBGPU_RENDERER_2026_10.md). Normal output adds 0-2 atlas pages in total */
export const CHURN_PAGES = 16;
export const CHURN_WINDOW_MS = 2_000;
/** On the DOM renderer this long, longer on each repeat */
export const CHURN_COOLDOWNS_MS = [30_000, 120_000, 600_000] as const;
/** A view calm this long starts again from the first cooldown */
const CALM_RESET_MS = 600_000;

export interface ChurnTrip {
  pages: number;
  overMs: number;
  domForMs: number;
}

// Views on one font and theme share an atlas and each forwards its page events: count a page once
let seen = new WeakSet<object>();
let unclaimed = 0;

export function notePage(canvas: object): void {
  if (seen.has(canvas)) return;
  seen.add(canvas);
  unclaimed++;
}

/** From a view's onRender: xterm fires it right after that view's renderRows, where pages are
 *  made, so the first claim after a page is the view that drew it */
export function claimPages(): number {
  const pages = unclaimed;
  unclaimed = 0;
  return pages;
}

export function resetPageNotes(): void {
  seen = new WeakSet();
  unclaimed = 0;
}

export function createChurnMeter() {
  let notes: Array<{ at: number; pages: number }> = [];
  let trips = 0;
  let lastTripAt = Number.NEGATIVE_INFINITY;
  return {
    /** Pages this view made at `now`: a trip once the window holds CHURN_PAGES */
    record(pages: number, now: number): ChurnTrip | null {
      notes = notes.filter((n) => now - n.at < CHURN_WINDOW_MS);
      notes.push({ at: now, pages });
      const total = notes.reduce((sum, n) => sum + n.pages, 0);
      if (total < CHURN_PAGES) return null;
      const overMs = now - (notes[0]?.at ?? now);
      notes = [];
      if (now - lastTripAt > CALM_RESET_MS) trips = 0;
      lastTripAt = now;
      const domForMs = CHURN_COOLDOWNS_MS.at(Math.min(trips, CHURN_COOLDOWNS_MS.length - 1)) ?? 0;
      trips++;
      return { pages: total, overMs, domForMs };
    },
  };
}
