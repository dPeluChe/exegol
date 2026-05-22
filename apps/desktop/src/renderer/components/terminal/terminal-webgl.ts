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
 */
export function createWebglController(terminal: Terminal): WebglController {
  let addon: WebglAddon | null = null;
  let canvasEl: HTMLCanvasElement | null = null;
  let restoreHandler: ((ev: Event) => void) | null = null;
  let lossHandler: ((ev: Event) => void) | null = null;
  let scheduledTimer: ReturnType<typeof setTimeout> | null = null;
  let retries = 0;
  let fellBack = false;
  let disposed = false;

  function findCanvas(): HTMLCanvasElement | null {
    const el = terminal.element;
    if (!el) return null;
    return el.querySelector("canvas");
  }

  function bindContextLossListeners(): void {
    canvasEl = findCanvas();
    if (!canvasEl) return;
    lossHandler = (ev) => {
      ev.preventDefault();
      onContextLost();
    };
    restoreHandler = () => {
      retries = 0;
    };
    canvasEl.addEventListener("webglcontextlost", lossHandler);
    canvasEl.addEventListener("webglcontextrestored", restoreHandler);
  }

  function unbindContextLossListeners(): void {
    if (canvasEl) {
      if (lossHandler) canvasEl.removeEventListener("webglcontextlost", lossHandler);
      if (restoreHandler) canvasEl.removeEventListener("webglcontextrestored", restoreHandler);
    }
    canvasEl = null;
    lossHandler = null;
    restoreHandler = null;
  }

  function onContextLost(): void {
    if (disposed) return;
    addon?.dispose();
    addon = null;
    unbindContextLossListeners();
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
      bindContextLossListeners();
    } catch {
      // WebGL not supported by this device — silently fall back to canvas.
      fellBack = true;
    }
  }

  function detach(): void {
    if (scheduledTimer) {
      clearTimeout(scheduledTimer);
      scheduledTimer = null;
    }
    unbindContextLossListeners();
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
