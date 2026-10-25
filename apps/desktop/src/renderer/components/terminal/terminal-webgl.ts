import { WebglAddon } from "@xterm/addon-webgl";
import type { Terminal } from "@xterm/xterm";
import { GPU_DROP_EVENT, GPU_REPAINT_EVENT, type GpuRepaintDetail } from "../../lib/gpu-repaint";
import { type ChurnTrip, claimPages, createChurnMeter, notePage } from "./atlas-churn";
import { type WebglBudget, webglBudget } from "./webgl-budget";
import { counts, trackWebglAddon } from "./webgl-counts";

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
  /** Lets go of the context and resets the retry budget. After a GPU crash every view drops first:
   *  xterm frees the glyph atlas they share (blank since the crash) only when its last view does */
  drop: () => void;
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
  /** This view's output churned the glyph atlas: on the DOM renderer for `domForMs` */
  onChurn?: (trip: ChurnTrip) => void;
}

/**
 * xterm 0.19's dispose removes the canvas but keeps its GL context, which still counts toward
 * Chromium's cap until garbage collected (xtermjs/xterm.js#6068): lose it on purpose. Drop once
 * the addon does it.
 */
function disposeAddon(addon: WebglAddon): void {
  const gl = (addon as unknown as { _renderer?: { _gl?: WebGL2RenderingContext } })._renderer?._gl;
  addon.dispose();
  trackWebglAddon(-1);
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
  { onLost, onRendererChanged, onChurn }: WebglHooks = {},
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
  let coolTimer: ReturnType<typeof setTimeout> | null = null;
  const churn = createChurnMeter();

  const pending = () => parked && !addon && !fellBack && !disposed && !coolTimer;

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
    if (disposed || fellBack || addon || parked || coolTimer) return "none";
    if (!budget.acquire(attach)) return budget.isDomOnly() ? "none" : "queued";
    let created: WebglAddon | null = null;
    try {
      created = new WebglAddon();
      // 0.19's loss timer can outlive dispose (fixed upstream in #5932)
      created.onContextLoss(() => {
        if (created === addon) onContextLost();
      });
      created.onAddTextureAtlasCanvas(notePage);
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
    trackWebglAddon(1);
    counts.attached++;
    awaitFirstDraw();
    // After the slot is held: a refit that throws must not release it
    onRendererChanged?.();
    return "attached";
  }

  function coolDown(trip: ChurnTrip): void {
    detach();
    onRendererChanged?.();
    onChurn?.(trip);
    coolTimer = setTimeout(() => {
      coolTimer = null;
      attach();
    }, trip.domForMs);
  }

  const renders = terminal.onRender(() => {
    const pages = claimPages();
    if (!pages || !addon) return;
    const trip = churn.record(pages, Date.now());
    if (trip) coolDown(trip);
  });

  function drop(): void {
    if (disposed) return;
    retries = 0;
    lastLossAt = 0;
    fellBack = false;
    detach();
  }

  function rebuild(): void {
    drop();
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
    renders.dispose();
    if (coolTimer) clearTimeout(coolTimer);
    coolTimer = null;
    // The terminal may live on without WebGL (a canvas-only CLI): never leave it hidden
    reveal();
    detach();
  }

  syncConceal();
  return { dispose, drop, rebuild, park, unpark, pending };
}

/**
 * One view's part in a GPU crash repaint (lib/gpu-repaint): drop on the first event, rebuild on
 * the second, then `repaint` (refit, refresh, kick a TUI; false while not mounted, so not counted)
 */
export function listenGpuRepaint(
  target: EventTarget,
  webgl: () => WebglController | null,
  repaint: () => boolean,
): () => void {
  const onDrop = () => webgl()?.drop();
  const onRepaint = (e: Event) => {
    try {
      webgl()?.rebuild();
      if (repaint()) (e as CustomEvent<GpuRepaintDetail>).detail.views++;
    } catch {
      /* not ready */
    }
  };
  target.addEventListener(GPU_DROP_EVENT, onDrop);
  target.addEventListener(GPU_REPAINT_EVENT, onRepaint);
  return () => {
    target.removeEventListener(GPU_DROP_EVENT, onDrop);
    target.removeEventListener(GPU_REPAINT_EVENT, onRepaint);
  };
}
