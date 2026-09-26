import { WebglAddon } from "@xterm/addon-webgl";
import type { Terminal } from "@xterm/xterm";

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
  /** Whether WebGL ultimately failed and we're on the DOM renderer. */
  hasFallenBack: () => boolean;
}

/**
 * Attach the WebGL addon to a terminal with context-loss recovery.
 *
 * xterm's own `webglcontextrestored` path redraws; `onContextLoss` fires only when that
 * failed (3s later). Disposing the addon swaps in the DOM renderer with a full refresh, then
 * we retry with backoff, and fall back for good once the delays run out. `onLost` lets the
 * owner kick the PTY: a TUI stayed blank after a GPU crash until it was resized.
 * Only `onContextLoss`: a second DOM listener on the same canvas double-fires per loss.
 */
export function createWebglController(terminal: Terminal, onLost?: () => void): WebglController {
  let addon: WebglAddon | null = null;
  let scheduledTimer: ReturnType<typeof setTimeout> | null = null;
  let retries = 0;
  let lastLossAt = 0;
  let fellBack = false;
  let disposed = false;

  function clearScheduled(): void {
    if (scheduledTimer) {
      clearTimeout(scheduledTimer);
      scheduledTimer = null;
    }
  }

  function onContextLost(): void {
    if (disposed) return;
    addon?.dispose();
    addon = null;
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
    if (disposed || fellBack || addon) return;
    try {
      const webgl = new WebglAddon();
      webgl.onContextLoss(() => onContextLost());
      terminal.loadAddon(webgl);
      addon = webgl;
    } catch {
      // WebGL unavailable on this device: xterm keeps the DOM renderer
      fellBack = true;
    }
  }

  function detach(): void {
    clearScheduled();
    addon?.dispose();
    addon = null;
  }

  function dispose(): void {
    disposed = true;
    detach();
  }

  return {
    attach,
    detach,
    dispose,
    hasFallenBack: () => fellBack,
  };
}
