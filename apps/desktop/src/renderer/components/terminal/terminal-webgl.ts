import { WebglAddon } from "@xterm/addon-webgl";
import type { Terminal } from "@xterm/xterm";

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 250;

export interface WebglController {
  attach: () => void;
  detach: () => void;
  dispose: () => void;
  /** Whether WebGL ultimately failed and we're on the canvas fallback. */
  hasFallenBack: () => boolean;
}

/**
 * Attach the WebGL addon to a terminal with context-loss recovery.
 *
 * Terax retries forever — we cap at MAX_RETRIES and fall back to the canvas
 * renderer so a broken GPU doesn't loop wedging the renderer.
 *
 * We rely solely on xterm's `WebglAddon.onContextLoss` callback. Adding a
 * second `webglcontextlost` DOM listener on the same canvas would double-fire
 * for a single GPU loss (xterm's internal listener targets the same node),
 * eating half the retry budget. xterm handles the restore path internally.
 */
export function createWebglController(terminal: Terminal): WebglController {
  let addon: WebglAddon | null = null;
  let scheduledTimer: ReturnType<typeof setTimeout> | null = null;
  let retries = 0;
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
    if (retries >= MAX_RETRIES) {
      fellBack = true;
      if (typeof console !== "undefined") {
        console.warn(
          "[TerminalWebgl] context lost; max retries exhausted, falling back to canvas renderer",
        );
      }
      return;
    }
    retries++;
    // Always clear before reassigning so a redundant loss event doesn't leak
    // the previously-scheduled retry timer (which would still attach()).
    clearScheduled();
    scheduledTimer = setTimeout(() => {
      scheduledTimer = null;
      if (disposed) return;
      attach();
    }, RETRY_DELAY_MS);
  }

  function attach(): void {
    if (disposed || fellBack || addon) return;
    try {
      const webgl = new WebglAddon();
      webgl.onContextLoss(() => onContextLost());
      terminal.loadAddon(webgl);
      addon = webgl;
    } catch {
      // WebGL not supported by this device — silently fall back to canvas.
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
