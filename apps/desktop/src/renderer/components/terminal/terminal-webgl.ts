import type { WebglCounts } from "@exegol/shared";
import { WebglAddon } from "@xterm/addon-webgl";
import type { Terminal } from "@xterm/xterm";
import { type WebglBudget, webglBudget } from "./webgl-budget";

/** Backoff: a crashed GPU process (window moved to another display) takes seconds to return */
const RETRY_DELAYS_MS = [250, 1_000, 3_000];
/** Up this long without a loss and the retry budget starts over */
const STABLE_RESET_MS = 60_000;
/** Every terminal loses its context in the same tick: spread the rebuilds */
const JITTER_MS = 200;
/** Longest a terminal stays concealed waiting for WebGL: then it shows whatever renderer it has */
const REVEAL_CAP_MS = 150;

export interface WebglController {
  dispose: () => void;
  /** A fresh addon and retry budget: after a GPU process crash the old context can look alive yet never draw */
  rebuild: () => void;
  /** Off screen: the context stays (no DOM frame and atlas rebuild on return) until a shown
   *  terminal needs its slot */
  park: () => void;
  unpark: () => void;
  /** A context is due on the next show: fits wait, WebGL cells are narrower than the DOM's */
  pending: () => boolean;
}

export interface WebglHooks {
  onLost?: () => void;
  /** The renderer changed or `pending` cleared: the owner refits (cell widths differ) */
  onRendererChanged?: () => void;
}

const counts: WebglCounts = { attached: 0, reused: 0, evicted: 0 };

/** Counted since load, read as differences by the project switch log */
export const webglCounts = (): WebglCounts => ({ ...counts });

/**
 * xterm 0.19's dispose removes the canvas but keeps its GL context, which still counts toward
 * Chromium's cap until garbage collected (xtermjs/xterm.js#6068): lose it on purpose. Drop once
 * the addon does it.
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

/**
 * The WebGL addon of one terminal, created parked (concealed until its first show draws).
 *
 * xterm's own `webglcontextrestored` path redraws; `onContextLoss` fires only when that
 * failed (3s later). Disposing the addon swaps in the DOM renderer with a full refresh, then
 * we retry with backoff, and fall back for good once the delays run out. `onLost` lets the
 * owner kick the PTY: a TUI stayed blank after a GPU crash until it was resized.
 * Only `onContextLoss`: a second DOM listener on the same canvas double-fires per loss.
 * A terminal about to get a new context stays at opacity 0 until xterm's first render with it,
 * so the DOM renderer's frame (wider cells, then the atlas build) never shows.
 */
export function createWebglController(
  terminal: Terminal,
  { onLost, onRendererChanged }: WebglHooks = {},
  budget: WebglBudget = webglBudget,
): WebglController {
  let addon: WebglAddon | null = null;
  let scheduledTimer: ReturnType<typeof setTimeout> | null = null;
  let retries = 0;
  let lastLossAt = 0;
  let fellBack = false;
  let disposed = false;
  let parked = true;
  let concealed = false;
  let revealTimer: ReturnType<typeof setTimeout> | null = null;
  let firstRender: { dispose: () => void } | null = null;
  // Bumped by every stop: a frame queued by a render before it no longer reveals
  let revealGen = 0;

  function conceal(): void {
    concealed = true;
    if (terminal.element) terminal.element.style.opacity = "0";
  }

  function stopReveal(): void {
    revealGen++;
    if (revealTimer) clearTimeout(revealTimer);
    revealTimer = null;
    firstRender?.dispose();
    firstRender = null;
  }

  function reveal(): void {
    stopReveal();
    if (!concealed) return;
    concealed = false;
    if (terminal.element) terminal.element.style.opacity = "";
  }

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
    counts.evicted++;
    conceal();
  };

  function onContextLost(): void {
    if (disposed) return;
    budget.unpark(evict);
    dropAddon();
    onLost?.();
    // Hidden: the next show takes a new context, never a DOM frame first
    if (parked) conceal();
    else onRendererChanged?.();
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

  // One frame past the first render: it can still be blank (xtermjs/xterm.js#6239)
  function awaitFirstDraw(): void {
    if (!concealed || firstRender) return;
    const gen = revealGen;
    firstRender = terminal.onRender(() => {
      firstRender?.dispose();
      firstRender = null;
      requestAnimationFrame(() => {
        if (gen === revealGen) reveal();
      });
    });
  }

  function attach(): void {
    // Parked: the new context waits until the terminal is shown again
    if (disposed || fellBack || addon || parked) return;
    if (!budget.acquire(attachWhenFree)) return;
    let webgl: WebglAddon | null = null;
    try {
      const created = new WebglAddon();
      webgl = created;
      // 0.19's loss timer can outlive dispose (fixed upstream in #5932)
      created.onContextLoss(() => {
        if (created === addon) onContextLost();
      });
      // Swapping the renderer refreshes every row: the next render is WebGL's
      terminal.loadAddon(created);
    } catch {
      // WebGL unavailable on this device: xterm keeps the DOM renderer
      try {
        webgl?.dispose();
      } catch {
        /* never loaded */
      }
      fellBack = true;
      budget.release();
      reveal();
      return;
    }
    addon = webgl;
    counts.attached++;
    awaitFirstDraw();
    // Outside the try: a refit that throws must not release a slot this terminal holds
    onRendererChanged?.();
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
    if (parked) conceal();
    else attach();
  }

  function park(): void {
    if (disposed || parked) return;
    parked = true;
    // Hidden: a reveal still owed waits for the next show
    stopReveal();
    if (addon) {
      budget.park(evict);
    } else {
      budget.cancelWait(attachWhenFree);
      if (!fellBack) conceal();
    }
  }

  function unpark(): void {
    if (disposed || !parked) return;
    parked = false;
    budget.unpark(evict);
    if (addon) counts.reused++;
    else attach();
    if (concealed) {
      // DOM only: no renderer swap is coming, so no reason to wait
      if (!addon && budget.isDomOnly()) {
        reveal();
      } else {
        // A context attached before it was hidden may not have drawn yet
        if (addon) awaitFirstDraw();
        revealTimer = setTimeout(reveal, REVEAL_CAP_MS);
      }
    }
    // No slot yet: `pending` cleared, so the DOM renderer is fitted and shown past the cap
    if (!addon) onRendererChanged?.();
  }

  function dispose(): void {
    disposed = true;
    // The terminal may live on without WebGL (a canvas-only CLI): never leave it hidden
    reveal();
    detach();
  }

  conceal();
  return {
    dispose,
    rebuild,
    park,
    unpark,
    pending: () => parked && !addon && !fellBack && !disposed,
  };
}
