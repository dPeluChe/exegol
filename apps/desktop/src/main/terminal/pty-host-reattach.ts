// Reattach to a session that survived in the sidecar (app restart), split out of PtyHost.
import { broadcast } from "../lib/event-bus";
import { HeadlessEmulator } from "./headless-emulator";
import type { Session, SessionCallbacks, ShellReadyState } from "./pty-session-types";
import type { SidecarClient } from "./pty-sidecar-client";
import type { SessionSnapshotResult } from "./pty-sidecar-protocol";
import { awaitsRepaint, REPAINT_CAP_MS, REPAINT_QUIET_MS } from "./reattach-repaint";
import { whileSidecarBulk } from "./sidecar-health-watch";
import { framesAfter, resyncFromRing } from "./sidecar-resync";

export interface ReattachedSession {
  snapshot: string | null;
  fetchMs: number;
  parseMs: number;
  /** Set when the pane's size reflowed a TUI's frame: resolves once the CLI repainted it */
  repainted: Promise<void> | null;
}

export interface ReattachOptions {
  scrollbackPath?: string;
  tui?: boolean;
  /** Only the ring's tail (a pane off screen) */
  snapshotMaxBytes?: number;
  /** Runs before the frames held during the read reach onData, so a scrollback seeded here
   *  ends with the newest output */
  onSnapshot?: (snapshot: string) => void;
}

/** What reattach needs from PtyHost */
export interface ReattachHost {
  sessions: Map<string, Session>;
  reattaching: Set<string>;
  pendingSizes: Map<string, { cols: number; rows: number }>;
  outputWatchers: Map<string, () => void>;
  client(): SidecarClient | null;
  applyFrame(s: Session, data: string, seq: number | undefined): void;
  finishExit(s: Session, exitCode: number, signal?: number): void;
  resize(id: string, cols: number, rows: number): void;
  redraw(id: string): void;
}

export function newSidecarSession(
  id: string,
  size: { cols: number; rows: number },
  callbacks: SessionCallbacks,
  scrollbackPath: string | undefined,
  shellReadyState: ShellReadyState,
): Session {
  return {
    id,
    mode: "sidecar",
    child: null,
    decoder: null,
    emulator: new HeadlessEmulator(size.cols, size.rows),
    pid: null,
    alive: true,
    callbacks,
    scrollbackPath: scrollbackPath ?? null,
    flushTimer: null,
    shellReadyState,
    preReadyStdinQueue: [],
    markerMatchPos: 0,
    markerHeldBytes: "",
    shellReadyTimeout: null,
  };
}

/** A Retry swap may drop the socket mid-read: the read is retried once on the new client */
async function readRing(
  host: ReattachHost,
  id: string,
  maxBytes: number | undefined,
): Promise<SessionSnapshotResult | null> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const client = host.client();
    if (!client) return null;
    try {
      return await whileSidecarBulk(client.snapshot(id, maxBytes));
    } catch {
      if (host.client() === client) return null;
    }
  }
  return null;
}

export async function reattachSidecarSession(
  host: ReattachHost,
  id: string,
  size: { cols: number; rows: number },
  callbacks: SessionCallbacks,
  options: ReattachOptions = {},
): Promise<ReattachedSession | null> {
  if (!host.client()?.isConnected()) return null;
  const session = newSidecarSession(id, size, callbacks, options.scrollbackPath, "unsupported");
  session.heldFrames = [];
  const { emulator } = session;
  host.sessions.set(id, session);
  host.reattaching.add(id);

  // The ring rebuilds the model only (replayed through onData it re-fired old status/OSC)
  const started = performance.now();
  let fetched = started;
  let ring: SessionSnapshotResult | null = null;
  try {
    ring = await readRing(host, id, options.snapshotMaxBytes);
    fetched = performance.now();
    if (ring?.data) await emulator.writeParsed(ring.data);
  } catch {
    // Parse failed: the session still reattaches, without its history
  } finally {
    host.reattaching.delete(id);
  }
  const parsed = performance.now();
  const snapshot = ring?.data ?? null;
  if (snapshot) options.onSnapshot?.(snapshot);
  drainHeld(host, session, ring?.seq);

  const pending = host.pendingSizes.get(id);
  let repainted: Promise<void> | null = null;
  if (pending) {
    host.pendingSizes.delete(id);
    const kind = { tui: options.tui ?? false, alternateScreen: emulator.alternateScreen };
    const repaint = awaitsRepaint(emulator.size, pending, kind);
    if (repaint) repainted = waitForRepaint(host.outputWatchers, id);
    host.resize(id, pending.cols, pending.rows);
    // The PTY may already be at this size (a stale saved grid): no SIGWINCH, no repaint
    if (repaint) host.redraw(id);
    broadcast("terminal:resized", id, pending.cols, pending.rows);
  }
  return { snapshot, fetchMs: fetched - started, parseMs: parsed - fetched, repainted };
}

/** Frames that came while the ring was read: those it already holds are dropped. An exit that
 *  came meanwhile runs after them, and a gap (frames lost to a Retry swap) rebuilds the model */
function drainHeld(host: ReattachHost, s: Session, ringSeq: number | undefined): void {
  const held = s.heldFrames ?? [];
  s.heldFrames = undefined;
  s.lastSeq = ringSeq;
  for (const f of framesAfter(held, ringSeq)) host.applyFrame(s, f.data, f.seq);
  const exit = s.pendingExit;
  s.pendingExit = undefined;
  if (exit) {
    host.finishExit(s, exit.exitCode, exit.signal);
    return;
  }
  const client = host.client();
  if (s.seqGap && client) void resyncFromRing(s, client, () => host.sessions.get(s.id) === s);
}

/** Resolves once the CLI's output pauses after the resize, or at the cap */
function waitForRepaint(watchers: Map<string, () => void>, id: string): Promise<void> {
  return new Promise((resolve) => {
    let quiet: ReturnType<typeof setTimeout> | undefined;
    const done = () => {
      clearTimeout(quiet);
      clearTimeout(cap);
      watchers.delete(id);
      resolve();
    };
    const cap = setTimeout(done, REPAINT_CAP_MS);
    watchers.set(id, () => {
      clearTimeout(quiet);
      quiet = setTimeout(done, REPAINT_QUIET_MS);
    });
  });
}
