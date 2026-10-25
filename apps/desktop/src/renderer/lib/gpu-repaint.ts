import { webglBudget } from "../components/terminal/webgl-budget";
import { dispatchRefitTerminals } from "./dispatch-refit";

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

function repaintTerminals(): void {
  window.dispatchEvent(new Event(GPU_DROP_EVENT));
  const detail: GpuRepaintDetail = { views: 0 };
  window.dispatchEvent(new CustomEvent<GpuRepaintDetail>(GPU_REPAINT_EVENT, { detail }));
  dispatchRefitTerminals();
  if (detail.views > 0) window.api.terminal.gpuRepainted?.(detail.views);
}

/** Every window (main, floating, settings) follows main's `gpu:process-gone` */
export function installGpuRepaint(): void {
  const gate = createGpuRepaintGate();
  let timer: ReturnType<typeof setTimeout> | null = null;
  const schedule = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      repaintTerminals();
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
