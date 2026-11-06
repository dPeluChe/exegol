export interface LoadFailure {
  error: string;
  url: string;
}

/** The main document of a pane since its last navigation started */
export interface PageLoad {
  startedAt: number;
  committedAt: number | null;
  domReady: boolean;
  failure: LoadFailure | null;
  /** Exegol stopped it: a resource never finished, the page may be partial */
  stopped: boolean;
}

// Counted from the start of the load, not per wait: one tool call meets at most two loads (before
// and after an action), and with its scripts that has to fit the shim's 30 s
export const LOAD_BUDGET_MS = 10_000;
/** Answered, but a blocking resource keeps the DOM from finishing */
const BLOCKED_DOM_MS = 25_000;

export const freshLoad = (startedAt: number): PageLoad => ({
  startedAt,
  committedAt: null,
  domReady: false,
  failure: null,
  stopped: false,
});

/** Past the budget. A document not answered yet is left alone: a dev server's first compile takes
 *  this long, and stopping it would leave a blank page */
export function shouldStopLoad(load: PageLoad, now: number): boolean {
  if (load.domReady) return true;
  return load.committedAt !== null && now - load.committedAt >= BLOCKED_DOM_MS;
}
