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
  /** Off screen: the context stays until a shown terminal needs its slot */
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
 * One terminal's WebGL addon, created parked. While `pending` the terminal is concealed and is
 * revealed a frame after WebGL's first render (150 ms cap), so the DOM renderer's frame (wider
 * cells, then the atlas build) never shows. Loss: xterm waits 3 s for a restore, then we retry.
 */
export function createWebglController(
  terminal: Terminal,
  { onLost, onRendererChanged }: WebglHooks = {},
  budget: WebglBudget = webglBudget,
): WebglController {
  let addon: WebglAddon | null = null;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let retries = 0;
  let lastLossAt = 0;
  let fellBack = false;
  let disposed = false;
  let parked = true;
  let concealed = false;
  let revealTimer: ReturnType<typeof setTimeout> | null = null;
  let revealRender: { dispose: () => void } | null = null;
  let revealFrame = 0;

  const pending = () => parked && !addon && !fellBack && !disposed;

  function setConcealed(hidden: boolean): void {
    concealed = hidden;
    if (terminal.element) terminal.element.style.opacity = hidden ? "0" : "";
  }

  // The one conceal rule: a context due on the next show means a renderer swap to hide
  function syncConceal(): void {
    if (pending() && !concealed) setConcealed(true);
  }

  function stopReveal(): void {
    if (revealTimer) clearTimeout(revealTimer);
    revealTimer = null;
    revealRender?.dispose();
    revealRender = null;
    if (revealFrame) cancelAnimationFrame(revealFrame);
    revealFrame = 0;
  }

  function reveal(): void {
    stopReveal();
    if (concealed) setConcealed(false);
  }

  // A frame past the first render: it can still be blank (xtermjs/xterm.js#6239)
  function awaitFirstDraw(): void {
    if (!concealed || revealRender || revealFrame) return;
    revealRender = terminal.onRender(() => {
      revealRender?.dispose();
      revealRender = null;
      revealFrame = requestAnimationFrame(reveal);
    });
  }

  function dropAddon(release: boolean): void {
    if (addon) {
      disposeAddon(addon);
      addon = null;
      if (release) budget.release();
    }
    syncConceal();
  }

  // The slot passes to a shown terminal, so no release
  const evict = () => {
    counts.evicted++;
    dropAddon(false);
  };

  function detach(): void {
    if (retryTimer) clearTimeout(retryTimer);
    retryTimer = null;
    budget.cancelWait(attach);
    budget.unpark(evict);
    dropAddon(true);
  }

  function onContextLost(): void {
    if (disposed) return;
    detach();
    onLost?.();
    if (!parked) onRendererChanged?.();
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
    retryTimer = setTimeout(
      () => {
        retryTimer = null;
        attach();
      },
      delay + Math.random() * JITTER_MS,
    );
  }

  /** `queued`: a slot frees later and attaches then; `none`: no renderer swap is coming */
  function attach(): "attached" | "queued" | "none" {
    // Parked: the new context waits until the terminal is shown again
    if (disposed || fellBack || addon || parked) return "none";
    if (!budget.acquire(attach)) return budget.isDomOnly() ? "none" : "queued";
    let created: WebglAddon | null = null;
    try {
      created = new WebglAddon();
      // 0.19's loss timer can outlive dispose (fixed upstream in #5932)
      created.onContextLoss(() => {
        if (created === addon) onContextLost();
      });
      // Swapping the renderer refreshes every row: the next render is WebGL's
      terminal.loadAddon(created);
    } catch {
      // WebGL unavailable on this device: xterm keeps the DOM renderer
      try {
        created?.dispose();
      } catch {
        /* never loaded */
      }
      fellBack = true;
      budget.release();
      reveal();
      return "none";
    }
    addon = created;
    counts.attached++;
    awaitFirstDraw();
    // After the slot is held: a refit that throws must not release it
    onRendererChanged?.();
    return "attached";
  }

  function rebuild(): void {
    if (disposed) return;
    retries = 0;
    lastLossAt = 0;
    fellBack = false;
    detach();
    attach();
  }

  function park(): void {
    if (disposed || parked) return;
    parked = true;
    // Hidden: a reveal still owed waits for the next show
    stopReveal();
    if (addon) budget.park(evict);
    else budget.cancelWait(attach);
    syncConceal();
  }

  function unpark(): void {
    if (disposed || !parked) return;
    parked = false;
    budget.unpark(evict);
    if (addon) counts.reused++;
    const swap = addon ? "attached" : attach();
    if (concealed && swap === "none") {
      reveal();
    } else if (concealed) {
      // A context attached before it was hidden may not have drawn yet; a queued one subscribes on attach
      if (addon) awaitFirstDraw();
      revealTimer = setTimeout(reveal, REVEAL_CAP_MS);
    }
    // No context yet: `pending` cleared, so the DOM renderer is fitted
    if (!addon) onRendererChanged?.();
  }

  function dispose(): void {
    disposed = true;
    // The terminal may live on without WebGL (a canvas-only CLI): never leave it hidden
    reveal();
    detach();
  }

  syncConceal();
  return { dispose, rebuild, park, unpark, pending };
}
