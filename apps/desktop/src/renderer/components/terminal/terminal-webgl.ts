import { WebglAddon } from "@xterm/addon-webgl";
import type { Terminal } from "@xterm/xterm";
import { type WebglBudget, webglBudget } from "./webgl-budget";

/** Backoff: a crashed GPU process (window moved to another display) takes seconds to return */
const RETRY_DELAYS_MS = [250, 1_000, 3_000];
/** Up this long without a loss and the retry budget starts over */
const STABLE_RESET_MS = 60_000;
/** Every terminal loses its context in the same tick: spread the rebuilds */
const JITTER_MS = 200;

export interface WebglController {
  attach: () => void;
  detach: () => void;
  dispose: () => void;
  /** A fresh addon and retry budget: after a GPU process crash the old context can look alive yet never draw */
  rebuild: () => void;
  /** Whether WebGL ultimately failed and we're on the DOM renderer. */
  hasFallenBack: () => boolean;
  /** Off screen: the context stays (no DOM frame and atlas rebuild on return) until a shown
   *  terminal needs its slot */
  park: () => void;
  /** Back on screen: `reused` drew at once, `attached` is a new context, `dom` waits for a slot */
  unpark: () => WebglReturn;
}

export type WebglReturn = "reused" | "attached" | "dom";

/**
 * Attach the WebGL addon to a terminal with context-loss recovery.
 *
 * xterm's own `webglcontextrestored` path redraws; `onContextLoss` fires only when that
 * failed (3s later). Disposing the addon swaps in the DOM renderer with a full refresh, then
 * we retry with backoff, and fall back for good once the delays run out. `onLost` lets the
 * owner kick the PTY: a TUI stayed blank after a GPU crash until it was resized.
 * Only `onContextLoss`: a second DOM listener on the same canvas double-fires per loss.
 */
/**
 * xterm 0.19's dispose removes the canvas but keeps its GL context, which still counts toward
 * Chromium's cap until garbage collected (xtermjs/xterm.js#6068): lose it on purpose.
 */
function disposeAddon(addon: WebglAddon): void {
  const gl = (addon as unknown as { _renderer?: { _gl?: WebGL2RenderingContext } })._renderer?._gl;
  addon.dispose();
  try {
    gl?.getExtension("WEBGL_lose_context")?.loseContext();
  } catch {
    /* already lost */
  }
}

export interface WebglHooks {
  onLost?: () => void;
  /** A shown terminal took this parked one's slot: it now draws on the DOM renderer */
  onEvicted?: () => void;
  /** A context attached; xterm draws with it on the next frame */
  onAttached?: () => void;
}

export function createWebglController(
  terminal: Terminal,
  { onLost, onEvicted, onAttached }: WebglHooks = {},
  budget: WebglBudget = webglBudget,
): WebglController {
  let addon: WebglAddon | null = null;
  let scheduledTimer: ReturnType<typeof setTimeout> | null = null;
  let retries = 0;
  let lastLossAt = 0;
  let fellBack = false;
  let disposed = false;
  let parked = false;

  function clearScheduled(): void {
    if (scheduledTimer) {
      clearTimeout(scheduledTimer);
      scheduledTimer = null;
    }
  }

  function dropAddon(): void {
    if (!addon) return;
    disposeAddon(addon);
    addon = null;
    budget.release();
  }

  // Denied at the cap: this terminal draws on the DOM renderer until a slot frees
  const attachWhenFree = () => attach();

  // The slot passes to a shown terminal, so no release
  const evict = () => {
    if (addon) disposeAddon(addon);
    addon = null;
    onEvicted?.();
  };

  function onContextLost(): void {
    if (disposed) return;
    budget.unpark(evict);
    dropAddon();
    onLost?.();
    const now = Date.now();
    if (now - lastLossAt > STABLE_RESET_MS) retries = 0;
    lastLossAt = now;
    const delay = RETRY_DELAYS_MS[retries];
    if (delay === undefined) {
      fellBack = true;
      console.warn("[TerminalWebgl] context lost; retries exhausted, staying on the DOM renderer");
      return;
    }
    retries++;
    // Always clear before reassigning so a redundant loss event doesn't leak
    // the previously-scheduled retry timer (which would still attach()).
    clearScheduled();
    scheduledTimer = setTimeout(
      () => {
        scheduledTimer = null;
        if (!disposed) attach();
      },
      delay + Math.random() * JITTER_MS,
    );
  }

  function attach(): void {
    // Parked: the new context waits until the terminal is shown again
    if (disposed || fellBack || addon || parked) return;
    if (!budget.acquire(attachWhenFree)) return;
    try {
      const webgl = new WebglAddon();
      webgl.onContextLoss(() => onContextLost());
      terminal.loadAddon(webgl);
      addon = webgl;
      budget.note("attached");
      onAttached?.();
    } catch {
      // WebGL unavailable on this device: xterm keeps the DOM renderer
      fellBack = true;
      budget.release();
    }
  }

  function detach(): void {
    clearScheduled();
    budget.cancelWait(attachWhenFree);
    budget.unpark(evict);
    dropAddon();
  }

  function rebuild(): void {
    if (disposed) return;
    detach();
    retries = 0;
    lastLossAt = 0;
    fellBack = false;
    // A parked terminal takes its new context when it is shown again
    if (parked) onEvicted?.();
    else attach();
  }

  function park(): void {
    if (disposed || parked) return;
    parked = true;
    if (addon) budget.park(evict);
    else budget.cancelWait(attachWhenFree);
  }

  function unpark(): WebglReturn {
    parked = false;
    budget.unpark(evict);
    if (addon) {
      budget.note("reused");
      return "reused";
    }
    attach();
    return addon ? "attached" : "dom";
  }

  function dispose(): void {
    disposed = true;
    detach();
  }

  return {
    attach,
    detach,
    dispose,
    rebuild,
    hasFallenBack: () => fellBack,
    park,
    unpark,
  };
}
