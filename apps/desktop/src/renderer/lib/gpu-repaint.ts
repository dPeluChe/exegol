import type { GpuRepaintReport } from "@exegol/shared";
import { webglBudget } from "../components/terminal/webgl-budget";
import { liveWebglAddons } from "../components/terminal/webgl-counts";

export interface WindowView {
  visible: boolean;
  focused: boolean;
}

/** The new GPU process and the compositor need a moment after the crash or the reveal */
const SETTLE_MS = 500;

export const GPU_REPAINT_EVENT = "exegol:gpu-repaint";
/** Sent first: every view lets go of WebGL before any rebuilds (terminal-webgl `drop`) */
export const GPU_DROP_EVENT = "exegol:gpu-drop";

export interface GpuRepaintDetail {
  /** Each terminal view that repainted adds one (dispatchEvent runs the handlers synchronously) */
  views: number;
}

/**
 * A GPU process crash leaves WebGL terminals blank, and while the window is hidden (another
 * Space, minimized) timers and frames are throttled, so a repaint then never shows. The loss
 * stays owed until the window is seen with the focus; a visible but unfocused window repaints
 * now and once more on focus.
 */
export function createGpuRepaintGate() {
  let pending = false;
  return {
    /** The GPU process went away: whether to repaint now */
    lost(view: WindowView): boolean {
      pending = !(view.visible && view.focused);
      return view.visible;
    },
    /** The window became visible or took the focus: whether a repaint is owed */
    shown(view: WindowView): boolean {
      if (!pending || !view.visible) return false;
      pending = !view.focused;
      return true;
    },
    isPending: () => pending,
  };
}

function currentView(): WindowView {
  return { visible: document.visibilityState === "visible", focused: document.hasFocus() };
}

/** Every view drops its context before any rebuilds: xterm frees the shared glyph atlas only once its last view lets go */
export function repaintTerminals(
  target: EventTarget,
  liveContexts: () => number,
): GpuRepaintReport {
  const before = liveContexts();
  target.dispatchEvent(new Event(GPU_DROP_EVENT));
  const afterDrop = liveContexts();
  const detail: GpuRepaintDetail = { views: 0 };
  target.dispatchEvent(new CustomEvent<GpuRepaintDetail>(GPU_REPAINT_EVENT, { detail }));
  return { views: detail.views, before, afterDrop, rebuilt: liveContexts() };
}

/** Every window (main, floating, settings) follows main's `gpu:process-gone` */
export function installGpuRepaint(): void {
  const gate = createGpuRepaintGate();
  let timer: ReturnType<typeof setTimeout> | null = null;
  const schedule = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      // Each view refits and refreshes in its own repaint: no refit-terminals pass after it
      const report = repaintTerminals(window, liveWebglAddons);
      if (report.views > 0) window.api.terminal.gpuRepainted?.(report);
    }, SETTLE_MS);
  };
  // A window opened after the third crash starts on the DOM renderer too
  window.api
    .gpuDomOnly?.()
    .then((domOnly) => {
      if (domOnly) webglBudget.setDomOnly();
    })
    .catch(() => {});
  window.api.onGpuProcessGone?.((event) => {
    // Before the repaint: its rebuild then lands every terminal on the DOM renderer
    if (event?.domOnly) webglBudget.setDomOnly();
    if (gate.lost(currentView())) schedule();
  });
  const onShown = () => {
    if (gate.shown(currentView())) schedule();
  };
  document.addEventListener("visibilitychange", onShown);
  window.addEventListener("focus", onShown);
}
