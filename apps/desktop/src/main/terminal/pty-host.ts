// PTY Host — manages PTY subprocess sessions from the main process (T35+T36+T37).
import type { ScreenDialog } from "@exegol/shared";
import { broadcast } from "../lib/event-bus";
import { logger } from "../lib/logger";
import { terminalProcesses, terminateAll } from "../system/process-tree";
import { readProcessTable } from "../system/shell-clis";
import { HeadlessEmulator } from "./headless-emulator";
import {
  encodeFrame,
  encodeJson,
  encodeString,
  FRAME_DISPOSE,
  FRAME_KILL,
  FRAME_RESIZE,
  FRAME_WRITE,
  type SpawnPayload,
} from "./pty-ipc";
import { doCreateLegacy, type LegacyHostDeps } from "./pty-legacy-session";
import { flushScrollbackSync, scheduleScrollbackFlush } from "./pty-scrollback";
import {
  MAX_CONCURRENT_SPAWNS,
  type Session,
  type SessionCallbacks,
  SHELL_READY_TIMEOUT_MS,
} from "./pty-session-types";
import { scanForMarker } from "./pty-shell-ready";
import type { SidecarClient } from "./pty-sidecar-client";
import { type SessionMemoryResult, SHELL_RING_BUFFER_CAPACITY } from "./pty-sidecar-protocol";
import { awaitsRepaint, REPAINT_CAP_MS, REPAINT_QUIET_MS } from "./reattach-repaint";
import { readScreenDialog } from "./screen-dialog";
import { trackSidecarCall, whileSidecarBulk } from "./sidecar-health-watch";

export type { SessionCallbacks } from "./pty-session-types";

export interface ReattachedSession {
  snapshot: string | null;
  fetchMs: number;
  parseMs: number;
  /** Set when the pane's size reflowed a TUI's frame: resolves once the CLI repainted it */
  repainted: Promise<void> | null;
}

export class PtyHost {
  private sessions = new Map<string, Session>();
  /** A pane can mount (and size itself) before its session is reattached;
   *  that size was dropped, so the PTY kept its old grid until the next resize */
  private pendingSizes = new Map<string, { cols: number; rows: number }>();
  /** Ring not parsed yet: a resize now would parse the rest of the ring at the wrong grid */
  private reattaching = new Set<string>();
  private outputWatchers = new Map<string, () => void>();
  private activeSpawns = 0;
  private spawnQueue: Array<() => void> = [];
  private sidecarClient: SidecarClient | null = null;
  private exitWaiters = new Map<string, Array<() => void>>();

  // ─── Sidecar integration ────────────────────────────────────────────

  /** Connect to a running sidecar process */
  connectToSidecar(client: SidecarClient): void {
    this.sidecarClient = client;

    client.onSessionData((id, data) => {
      const s = this.sessions.get(id);
      if (!s) return;

      let processedData = data;
      if (s.shellReadyState === "pending") {
        const scan = scanForMarker(data, s);
        processedData = scan.processedData;
        if (scan.markerFound) {
          this.resolveShellReady(s, "ready");
        }
      }

      if (processedData.length > 0) {
        s.emulator.write(processedData);
        s.resyncTail?.push(processedData);
        scheduleScrollbackFlush(s);
        s.callbacks.onData(processedData);
        this.outputWatchers.get(id)?.();
      }
    });

    client.onSessionExit((id, exitCode, signal) => {
      const s = this.sessions.get(id);
      if (!s) return;
      s.alive = false;
      flushScrollbackSync(s);
      this.cleanup(id);
      s.callbacks.onExit(exitCode, signal);
    });

    client.onSessionError((id, message) => {
      const s = this.sessions.get(id);
      if (!s) return;
      s.callbacks.onError(message);
    });

    logger.info("[PtyHost] Connected to sidecar");
  }

  /** Retry: the new client takes over before the old socket closes. Both carried the same
   *  output, unevenly (the old one was stuck), so each live model is rebuilt from the ring */
  swapSidecarClient(client: SidecarClient): Promise<void> {
    const old = this.sidecarClient;
    this.connectToSidecar(client);
    old?.disconnect();
    const live = [...this.sessions.values()].filter(
      (s) => s.mode === "sidecar" && s.alive && !this.reattaching.has(s.id),
    );
    return Promise.all(live.map((s) => this.resyncSession(s, client))).then(() => {});
  }

  /** Output read before the ring's reply is in it; output after it is replayed on top. Views
   *  reset (RIS) and repaint in the same stream, as the visibility repaint does */
  private async resyncSession(s: Session, client: SidecarClient): Promise<void> {
    const ring = await whileSidecarBulk(client.snapshot(s.id)).catch(() => null);
    if (ring === null || this.sessions.get(s.id) !== s || s.resyncTail) return;
    const tail: string[] = [];
    s.resyncTail = tail;
    const { cols, rows } = s.emulator.size;
    const fresh = new HeadlessEmulator(cols, rows);
    try {
      await fresh.writeParsed(ring);
    } finally {
      s.resyncTail = undefined;
    }
    if (this.sessions.get(s.id) !== s) {
      fresh.dispose();
      return;
    }
    const size = s.emulator.size;
    if (size.cols !== cols || size.rows !== rows) fresh.resize(size.cols, size.rows);
    const snapshot = (fresh.snapshot() ?? "") + fresh.modeSequence();
    for (const chunk of tail) fresh.write(chunk);
    s.emulator.dispose();
    s.emulator = fresh;
    broadcast("terminal:data", s.id, `\x1bc${snapshot}${tail.join("")}`);
  }

  getSidecarClient(): SidecarClient | null {
    return this.sidecarClient;
  }

  /** The calls a keystroke or pane depends on: the health watch sees each one */
  private callSidecar(
    method: string,
    id: string,
    call: (client: SidecarClient) => Promise<void>,
  ): void {
    const client = this.sidecarClient;
    if (!client) return;
    trackSidecarCall(method, id, call(client), client);
  }

  disconnectSidecar(): void {
    this.sidecarClient?.disconnect();
    this.sidecarClient = null;
  }

  isUsingSidecar(): boolean {
    return this.sidecarClient?.isConnected() ?? false;
  }

  /** List sessions alive in the sidecar (for crash recovery) */
  async listSidecarSessions(): Promise<string[]> {
    if (!this.sidecarClient?.isConnected()) return [];
    return this.sidecarClient.listSessions();
  }

  /**
   * List sessions with alive flag + exit info.
   * Use this over listSidecarSessions() for crash recovery, because the
   * sidecar keeps dead sessions in its map for 60s (snapshot grace period).
   * Treating them as alive leaves agents stuck in "running" with no PTY.
   */
  async listSidecarSessionsInfo(): Promise<
    Array<{ id: string; alive: boolean; exitCode: number | null; signal: string | null }>
  > {
    if (!this.sidecarClient?.isConnected()) return [];
    return this.sidecarClient.listSessionsInfo();
  }

  /** T143: per-session ring buffer memory usage, for Monitor > Resources */
  async getSidecarMemoryInfo(): Promise<SessionMemoryResult | null> {
    if (!this.sidecarClient?.isConnected()) return null;
    try {
      return await this.sidecarClient.getMemoryInfo();
    } catch {
      return null;
    }
  }

  /** Reattach to a session that survived in the sidecar after app restart */
  async reattachSession(
    id: string,
    spawnOpts: { cols: number; rows: number },
    callbacks: SessionCallbacks,
    options?: { scrollbackPath?: string; tui?: boolean },
  ): Promise<ReattachedSession | null> {
    if (!this.sidecarClient?.isConnected()) return null;

    const emulator = new HeadlessEmulator(spawnOpts.cols, spawnOpts.rows);
    const session: Session = {
      id,
      mode: "sidecar",
      child: null,
      decoder: null,
      emulator,
      pid: null,
      alive: true,
      callbacks,
      scrollbackPath: options?.scrollbackPath ?? null,
      flushTimer: null,
      shellReadyState: "unsupported",
      preReadyStdinQueue: [],
      markerMatchPos: 0,
      markerHeldBytes: "",
      shellReadyTimeout: null,
    };
    this.sessions.set(id, session);
    this.reattaching.add(id);

    // The ring rebuilds the model only (replayed through onData it re-fired old status/OSC);
    // the caller seeds its scrollback from the returned snapshot
    let snapshot: string | null = null;
    const started = performance.now();
    let fetched = started;
    try {
      snapshot = await whileSidecarBulk(this.sidecarClient.snapshot(id));
      fetched = performance.now();
      if (snapshot) await emulator.writeParsed(snapshot);
    } catch {
      // Snapshot unavailable — session still reattaches, just without scrollback history
    } finally {
      this.reattaching.delete(id);
    }
    const parsed = performance.now();

    const pending = this.pendingSizes.get(id);
    let repainted: Promise<void> | null = null;
    if (pending) {
      this.pendingSizes.delete(id);
      const kind = { tui: options?.tui ?? false, alternateScreen: emulator.alternateScreen };
      const repaint = awaitsRepaint(emulator.size, pending, kind);
      if (repaint) repainted = this.waitForRepaint(id);
      this.resize(id, pending.cols, pending.rows);
      // The PTY may already be at this size (a stale saved grid): no SIGWINCH, no repaint
      if (repaint) this.redraw(id);
      broadcast("terminal:resized", id, pending.cols, pending.rows);
    }
    return { snapshot, fetchMs: fetched - started, parseMs: parsed - fetched, repainted };
  }

  /** Resolves once the CLI's output pauses after the resize, or at the cap */
  private waitForRepaint(id: string): Promise<void> {
    return new Promise((resolve) => {
      let quiet: ReturnType<typeof setTimeout> | undefined;
      const done = () => {
        clearTimeout(quiet);
        clearTimeout(cap);
        this.outputWatchers.delete(id);
        resolve();
      };
      const cap = setTimeout(done, REPAINT_CAP_MS);
      this.outputWatchers.set(id, () => {
        clearTimeout(quiet);
        quiet = setTimeout(done, REPAINT_QUIET_MS);
      });
    });
  }

  /** Create a new PTY session — uses sidecar if available, falls back to subprocess */
  async createSession(
    id: string,
    spawnOpts: SpawnPayload,
    callbacks: SessionCallbacks,
    options?: { scrollbackPath?: string; shellReadyGating?: boolean; smallRingBuffer?: boolean },
  ): Promise<{ pid: number }> {
    this.pendingSizes.delete(id);
    if (this.sidecarClient?.isConnected()) {
      return this.doCreateSidecar(id, spawnOpts, callbacks, options);
    }
    await this.acquireSpawnSlot();
    try {
      return await this.doCreateLegacy(id, spawnOpts, callbacks, options);
    } finally {
      this.releaseSpawnSlot();
    }
  }

  private async doCreateSidecar(
    id: string,
    spawnOpts: SpawnPayload,
    callbacks: SessionCallbacks,
    options?: { scrollbackPath?: string; shellReadyGating?: boolean; smallRingBuffer?: boolean },
  ): Promise<{ pid: number }> {
    const emulator = new HeadlessEmulator(spawnOpts.cols, spawnOpts.rows);
    const session: Session = {
      id,
      mode: "sidecar",
      child: null,
      decoder: null,
      emulator,
      pid: null,
      alive: true,
      callbacks,
      scrollbackPath: options?.scrollbackPath ?? null,
      flushTimer: null,
      shellReadyState: options?.shellReadyGating ? "pending" : "unsupported",
      preReadyStdinQueue: [],
      markerMatchPos: 0,
      markerHeldBytes: "",
      shellReadyTimeout: null,
    };
    this.sessions.set(id, session);

    if (session.shellReadyState === "pending") {
      session.shellReadyTimeout = setTimeout(() => {
        this.resolveShellReady(session, "timed_out");
      }, SHELL_READY_TIMEOUT_MS);
    }

    // biome-ignore lint/style/noNonNullAssertion: checked above
    const result = await this.sidecarClient!.createSession({
      id,
      shell: spawnOpts.shell,
      args: spawnOpts.args,
      cwd: spawnOpts.cwd,
      cols: spawnOpts.cols,
      rows: spawnOpts.rows,
      env: spawnOpts.env,
      bufferCapacity: options?.smallRingBuffer ? SHELL_RING_BUFFER_CAPACITY : undefined,
    });

    session.pid = result.pid;
    return { pid: result.pid };
  }

  private doCreateLegacy(
    id: string,
    spawnOpts: SpawnPayload,
    callbacks: SessionCallbacks,
    options?: { scrollbackPath?: string; shellReadyGating?: boolean },
  ): Promise<{ pid: number }> {
    const host: LegacyHostDeps = {
      sessions: this.sessions,
      resolveShellReady: (s, st) => this.resolveShellReady(s, st),
      cleanup: (id2) => this.cleanup(id2),
    };
    return doCreateLegacy(host, id, spawnOpts, callbacks, options);
  }

  write(id: string, data: string): void {
    const s = this.sessions.get(id);
    if (!s?.alive) return;
    if (s.shellReadyState === "pending") {
      if (data.startsWith("\x1b")) return;
      s.preReadyStdinQueue.push(data);
      return;
    }
    if (s.mode === "sidecar") {
      this.callSidecar("session.write", id, (c) => c.write(id, data));
      return;
    }
    try {
      s.child?.stdin?.write(encodeString(FRAME_WRITE, data));
    } catch {
      /* pipe broken */
    }
  }

  resize(id: string, cols: number, rows: number): void {
    const s = this.sessions.get(id);
    if (!s || this.reattaching.has(id)) {
      this.pendingSizes.set(id, { cols, rows });
      return;
    }
    if (!s.alive) return;
    s.emulator.resize(cols, rows);
    this.resizePty(s, cols, rows);
  }

  /** Make the CLI repaint at its current size: a size change is the only
   *  signal every TUI honours. The model keeps its real grid throughout. */
  redraw(id: string): void {
    const s = this.sessions.get(id);
    if (!s?.alive) return;
    const { cols, rows } = s.emulator.size;
    if (cols < 3) return;
    this.resizePty(s, cols - 1, rows);
    setTimeout(() => {
      if (s.alive) this.resizePty(s, s.emulator.size.cols, s.emulator.size.rows);
    }, 60);
  }

  /** Clear Terminal: forget the history here and in the sidecar (no reattach replays it), then
   *  Ctrl+L so the shell or TUI draws a clean screen */
  clear(id: string): void {
    const s = this.sessions.get(id);
    if (!s) return;
    s.emulator.clear();
    scheduleScrollbackFlush(s);
    if (s.mode === "sidecar") this.sidecarClient?.clear(id).catch(() => {});
    this.write(id, "\x0c");
  }

  private resizePty(s: Session, cols: number, rows: number): void {
    if (s.mode === "sidecar") {
      this.callSidecar("session.resize", s.id, (c) => c.resize(s.id, cols, rows));
      return;
    }
    try {
      s.child?.stdin?.write(encodeJson(FRAME_RESIZE, { cols, rows }));
    } catch {
      /* pipe broken */
    }
  }

  /** Ends the session and what it started (`terminalProcesses`), read while the shell still holds
   *  it: once the shell dies its children are reparented and its tty released */
  kill(id: string): void {
    const s = this.sessions.get(id);
    if (!s?.alive) return;
    const read = s.pid ? readProcessTable().catch(() => []) : Promise.resolve([]);
    void read.then((rows) => {
      const started = s.pid ? terminalProcesses(s.pid, rows) : [];
      this.killPty(s);
      terminateAll(started);
    });
  }

  private killPty(s: Session): void {
    const id = s.id;
    if (s.mode === "sidecar") {
      this.callSidecar("session.kill", id, (c) => c.kill(id));
      return;
    }
    try {
      s.child?.stdin?.write(encodeFrame(FRAME_KILL, Buffer.alloc(0)));
    } catch {
      /* pipe broken */
    }
  }

  /** Kill a sidecar session that has no local `sessions` entry (orphan sweep).
   *  `kill()` no-ops for unmapped ids, which left zombies alive across restarts. */
  killUnclaimed(id: string): void {
    this.callSidecar("session.kill", id, (c) => c.kill(id));
  }

  /** The PTY's real grid; mirrors render at this size instead of resizing it. */
  getSize(id: string): { cols: number; rows: number } | null {
    return this.sessions.get(id)?.emulator.size ?? null;
  }

  /** The grid the PTY ends up at: a size held during a reattach wins over the model's */
  requestedSize(id: string): { size: { cols: number; rows: number } | null; held: boolean } {
    const pending = this.pendingSizes.get(id);
    return pending ? { size: pending, held: true } : { size: this.getSize(id), held: false };
  }

  hasContent(id: string): boolean {
    return this.sessions.get(id)?.emulator.hasContent ?? false;
  }

  getSnapshot(id: string): string | null {
    return this.sessions.get(id)?.emulator.snapshot() ?? null;
  }

  /** For a live view that resets and repaints: the screen plus the modes its program set */
  getLiveSnapshot(id: string): string | null {
    const emulator = this.sessions.get(id)?.emulator;
    const snapshot = emulator?.snapshot();
    return emulator && snapshot ? snapshot + emulator.modeSequence() : null;
  }

  /** The numbered dialog the session's screen shows now, if any */
  screenDialog(id: string): ScreenDialog | null {
    const lines = this.sessions.get(id)?.emulator.visibleLines();
    return lines ? readScreenDialog(lines) : null;
  }

  isAlive(id: string): boolean {
    return this.sessions.get(id)?.alive ?? false;
  }

  getPid(id: string): number | null {
    return this.sessions.get(id)?.pid ?? null;
  }

  /** Resolve when the session is cleaned up (exit), or after timeoutMs as a fallback. */
  waitForExit(id: string, timeoutMs: number): Promise<void> {
    if (!this.sessions.has(id)) return Promise.resolve();
    return new Promise((resolve) => {
      const waiter = () => {
        clearTimeout(timer);
        resolve();
      };
      const timer = setTimeout(() => {
        const list = this.exitWaiters.get(id);
        if (list) {
          const idx = list.indexOf(waiter);
          if (idx !== -1) list.splice(idx, 1);
          if (list.length === 0) this.exitWaiters.delete(id);
        }
        resolve();
      }, timeoutMs);
      const list = this.exitWaiters.get(id) ?? [];
      list.push(waiter);
      this.exitWaiters.set(id, list);
    });
  }

  private notifyExitWaiters(id: string): void {
    const waiters = this.exitWaiters.get(id);
    if (!waiters) return;
    this.exitWaiters.delete(id);
    for (const w of waiters) w();
  }

  listSessions(): string[] {
    return Array.from(this.sessions.keys());
  }

  destroyAll(): void {
    for (const [, session] of this.sessions) {
      this.forceKillSession(session);
    }
    this.sessions.clear();
    for (const id of [...this.exitWaiters.keys()]) {
      this.notifyExitWaiters(id);
    }
  }

  /** Force-kill a session: flush scrollback, send dispose, then SIGKILL as safety net */
  private forceKillSession(session: Session): void {
    if (!session.alive) return;
    session.alive = false;
    flushScrollbackSync(session);

    if (session.mode === "sidecar") {
      this.sidecarClient?.destroy(session.id).catch(() => {});
    } else if (session.child) {
      try {
        session.child.stdin?.write(encodeFrame(FRAME_DISPOSE, Buffer.alloc(0)));
      } catch {
        /* pipe closed */
      }
      const child = session.child;
      setTimeout(() => {
        if (!child.killed) {
          try {
            child.kill("SIGKILL");
          } catch {
            /* already dead */
          }
        }
      }, 1000);
    }

    if (session.flushTimer) clearTimeout(session.flushTimer);
    session.emulator.dispose();
  }

  // ─── Private ──────────────────────────────────────────────────────────

  private resolveShellReady(session: Session, state: "ready" | "timed_out"): void {
    if (session.shellReadyState !== "pending") return;
    session.shellReadyState = state;
    if (session.shellReadyTimeout) {
      clearTimeout(session.shellReadyTimeout);
      session.shellReadyTimeout = null;
    }
    // Flush any held marker bytes as regular output (partial match that never completed)
    if (session.markerHeldBytes.length > 0) {
      session.emulator.write(session.markerHeldBytes);
      session.callbacks.onData(session.markerHeldBytes);
      session.markerHeldBytes = "";
    }
    session.markerMatchPos = 0;
    // Flush queued stdin writes in FIFO order
    const queue = session.preReadyStdinQueue;
    session.preReadyStdinQueue = [];
    for (const data of queue) {
      if (session.mode === "sidecar") {
        this.callSidecar("session.write", session.id, (c) => c.write(session.id, data));
      } else {
        try {
          session.child?.stdin?.write(encodeString(FRAME_WRITE, data));
        } catch {
          /* pipe broken */
        }
      }
    }
    if (state === "timed_out") {
      logger.warn(`[PtyHost] Shell ready marker timed out for ${session.id} — unblocking writes`);
    }
  }

  private cleanup(id: string): void {
    const session = this.sessions.get(id);
    if (!session) return;
    if (session.flushTimer) clearTimeout(session.flushTimer);
    if (session.shellReadyTimeout) clearTimeout(session.shellReadyTimeout);
    flushScrollbackSync(session);
    session.emulator.dispose();
    this.sessions.delete(id);
    this.notifyExitWaiters(id);
  }

  // ── Spawn semaphore (max 3 concurrent) ────────────────────────────────

  private acquireSpawnSlot(): Promise<void> {
    if (this.activeSpawns < MAX_CONCURRENT_SPAWNS) {
      this.activeSpawns++;
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      this.spawnQueue.push(resolve);
    });
  }

  private releaseSpawnSlot(): void {
    const next = this.spawnQueue.shift();
    if (next) {
      next();
    } else {
      this.activeSpawns--;
    }
  }
}

// ─── Singleton ──────────────────────────────────────────────────────────

let instance: PtyHost | null = null;

export function getPtyHost(): PtyHost {
  if (!instance) instance = new PtyHost();
  return instance;
}
