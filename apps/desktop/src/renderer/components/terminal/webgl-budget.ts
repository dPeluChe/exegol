/** Chromium drops the oldest WebGL context past ~16 per renderer; panes, a floating
 *  terminal and the GPU's own churn must stay well under that */
export const MAX_WEBGL_CONTEXTS = 8;
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
}

export function createWebglBudget(cap = MAX_WEBGL_CONTEXTS, onChange?: () => void): WebglBudget {
  let live = 0;
  let domOnly = false;
  let capped = false;
  const waiters: Array<() => void> = [];
  return {
    acquire(onFree) {
      if (domOnly) return false;
      if (live < cap) {
        live++;
        onChange?.();
        return true;
      }
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
