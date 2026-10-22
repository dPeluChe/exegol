/** Chromium drops the oldest WebGL context past 16 per renderer. Disposed addons now lose their
 *  context at once (terminal-webgl), so 12 leaves room for churn and keeps more hidden ones parked */
export const MAX_WEBGL_CONTEXTS = 12;
const REPORT_DEBOUNCE_MS = 1_000;

export interface WebglBudget {
  /** One context slot. Denied at the cap, `onFree` runs when a slot frees (never in DOM-only mode) */
  acquire: (onFree?: () => void) => boolean;
  release: () => void;
  cancelWait: (onFree: () => void) => void;
  /** Three GPU crashes in 10 min (main's rule): no new contexts this session */
  setDomOnly: () => void;
  isDomOnly: () => boolean;
  live: () => number;
  /** The cap denied a context at least once */
  capped: () => boolean;
  /** A hidden terminal keeps its context but offers the slot: at the cap the oldest parked one is
   *  evicted (`evict` drops the addon without `release`, the slot passes on) */
  park: (evict: () => void) => void;
  unpark: (evict: () => void) => void;
  /** Counted since load, read as differences by the project switch log */
  counts: () => WebglCounts;
  /** A context was created (`attached`) or a parked one shown again (`reused`) */
  note: (event: "attached" | "reused") => void;
}

export interface WebglCounts {
  attached: number;
  reused: number;
  evicted: number;
}

export function createWebglBudget(cap = MAX_WEBGL_CONTEXTS, onChange?: () => void): WebglBudget {
  let live = 0;
  let domOnly = false;
  let capped = false;
  const waiters: Array<() => void> = [];
  // Oldest first: the least recently hidden context goes first
  const parked: Array<() => void> = [];
  const counts: WebglCounts = { attached: 0, reused: 0, evicted: 0 };
  const evictOldest = (): boolean => {
    const evict = parked.shift();
    if (!evict) return false;
    counts.evicted++;
    evict();
    return true;
  };
  return {
    acquire(onFree) {
      if (domOnly) return false;
      if (live < cap) {
        live++;
        onChange?.();
        return true;
      }
      if (evictOldest()) return true;
      if (!capped) {
        capped = true;
        onChange?.();
      }
      if (onFree && !waiters.includes(onFree)) waiters.push(onFree);
      return false;
    },
    release() {
      live = Math.max(0, live - 1);
      onChange?.();
      waiters.shift()?.();
    },
    cancelWait(onFree) {
      const at = waiters.indexOf(onFree);
      if (at >= 0) waiters.splice(at, 1);
    },
    setDomOnly() {
      domOnly = true;
      waiters.length = 0;
    },
    isDomOnly: () => domOnly,
    live: () => live,
    capped: () => capped,
    park(evict) {
      if (!parked.includes(evict)) parked.push(evict);
      // A shown terminal is drawing on the DOM renderer for want of a slot: it takes this one
      const waiter = waiters.shift();
      if (!waiter) return;
      evictOldest();
      live--;
      waiter();
    },
    unpark(evict) {
      const at = parked.indexOf(evict);
      if (at >= 0) parked.splice(at, 1);
    },
    counts: () => ({ ...counts }),
    note(event) {
      counts[event]++;
    },
  };
}

let mountedViews = 0;
let reportTimer: ReturnType<typeof setTimeout> | null = null;

/** Main keeps the last counts per window to log them with a GPU crash */
function scheduleReport(): void {
  if (reportTimer) return;
  reportTimer = setTimeout(() => {
    reportTimer = null;
    try {
      window.api.terminal.gpuStats?.({
        views: mountedViews,
        webgl: webglBudget.live(),
        capped: webglBudget.capped(),
      });
    } catch {
      /* no preload (tests) */
    }
  }, REPORT_DEBOUNCE_MS);
}

/** This window's budget: every renderer process has its own context limit */
export const webglBudget = createWebglBudget(MAX_WEBGL_CONTEXTS, scheduleReport);

export function trackTerminalView(): () => void {
  mountedViews++;
  scheduleReport();
  return () => {
    mountedViews--;
    scheduleReport();
  };
}
