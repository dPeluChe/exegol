// PTY Host — manages PTY subprocess sessions from the main process (T35+T36+T37).
import type { ScreenDialog } from "@exegol/shared";
import { noteSessionActivity } from "../agents/session-activity";
import { createLimiter } from "../lib/concurrency";
import { logger } from "../lib/logger";
import { terminalProcesses, terminateAll } from "../system/process-tree";
import { readProcessTable } from "../system/shell-clis";
import { ExitWaiters } from "./exit-waiters";
import { SidecarLossHandler } from "./pty-host-loss";
import {
  newSidecarSession,
  type ReattachedSession,
  type ReattachHost,
  type ReattachOptions,
  reattachSidecarSession,
} from "./pty-host-reattach";
import {
  encodeFrame,
  encodeJson,
  encodeString,
  FRAME_KILL,
  FRAME_RESIZE,
  FRAME_WRITE,
  type SpawnPayload,
} from "./pty-ipc";
import { doCreateLegacy, forceKillSession, type LegacyHostDeps } from "./pty-legacy-session";
import { flushScrollbackSync, scheduleScrollbackFlush } from "./pty-scrollback";
import {
  MAX_CONCURRENT_SPAWNS,
  type Session,
  type SessionCallbacks,
  SHELL_READY_TIMEOUT_MS,
} from "./pty-session-types";
import { resolveShellReady, scanForMarker } from "./pty-shell-ready";
import type { SidecarClient } from "./pty-sidecar-client";
import { type SessionMemoryResult, SHELL_RING_BUFFER_CAPACITY } from "./pty-sidecar-protocol";
import { readScreenDialog } from "./screen-dialog";
import { trackSidecarCall } from "./sidecar-health-watch";
import { isFrameGap, isStaleFrame, lostFrames, resyncFromRing } from "./sidecar-resync";

export type { ReattachedSession } from "./pty-host-reattach";
export type { SessionCallbacks } from "./pty-session-types";

export class PtyHost {
  private sessions = new Map<string, Session>();
  /** A pane can mount (and size itself) before its session is reattached;
   *  that size was dropped, so the PTY kept its old grid until the next resize */
  private pendingSizes = new Map<string, { cols: number; rows: number }>();
  /** Ring not parsed yet: a resize now would parse the rest of the ring at the wrong grid */
  private reattaching = new Set<string>();
  private outputWatchers = new Map<string, () => void>();
  private spawnSlot = createLimiter(MAX_CONCURRENT_SPAWNS);
  private sidecarClient: SidecarClient | null = null;
  private exitWaiters = new ExitWaiters();
  private loss = new SidecarLossHandler({
    sessions: this.sessions,
    finishNormal: (s, code, signal) => this.finishExitNow(s, code, signal),
    finishLost: (s, reason, persist) => this.finishLost(s, reason, persist),
  });

  // ─── Sidecar integration ────────────────────────────────────────────

  /** Connect to a running sidecar process */
  connectToSidecar(client: SidecarClient): void {
    this.sidecarClient = client;

    client.onSessionData((id, data, seq) => {
      const s = this.sessions.get(id);
      if (!s) return;
      if (s.heldFrames) {
        s.heldFrames.push({ data, seq });
        return;
      }
      this.applyFrame(s, data, seq);
    });

    client.onSessionExit((id, exitCode, signal) => {
      const s = this.sessions.get(id);
      if (!s) return;
      if (s.heldFrames) s.pendingExit = { exitCode, signal };
      else this.finishExit(s, exitCode, signal);
    });

    client.onSessionError((id, message) => {
      const s = this.sessions.get(id);
      if (!s) return;
      s.callbacks.onError(message);
    });

    client.onShuttingDown((reason, ids) => this.loss.notice(reason, ids));
    client.onClose(() => {
      if (this.sidecarClient === client) this.loss.socketClosed();
    });

    logger.info("[PtyHost] Connected to sidecar");
  }

  /** A sidecar exit: the CLI's own, or one the sidecar's stop caused (pty-host-loss.ts) */
  private finishExit(s: Session, exitCode: number, signal?: number): void {
    this.loss.exit(s, exitCode, signal);
  }

  private finishExitNow(s: Session, exitCode: number, signal?: number): void {
    this.endSession(s);
    s.callbacks.onExit(exitCode, signal);
  }

  private finishLost(s: Session, reason: string, persist: boolean): void {
    this.endSession(s);
    if (s.callbacks.onLost) s.callbacks.onLost(reason, persist);
    else s.callbacks.onExit(1);
  }

  /** After the sessions a sidecar stop took are marked lost (not while relaunching) */
  onSidecarLost(fn: (reason: string) => void): void {
    this.loss.onSidecarLost(fn);
  }

  /** Restart terminals: the relaunch's recovery takes the sessions */
  expectRelaunch(): void {
    this.loss.expectRelaunch();
  }

  private applyFrame(s: Session, data: string, seq: number | undefined): void {
    if (isStaleFrame(s.lastSeq, seq)) return;
    if (isFrameGap(s.lastSeq, seq)) s.seqGap = true;
    if (seq !== undefined) s.lastSeq = seq;

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
      this.outputWatchers.get(s.id)?.();
    }
  }

  /** Retry: the new client takes over before the old socket closes. Only sessions that lost
   *  frames on the old socket (by seq) are rebuilt from the ring; the rest were exact already */
  async swapSidecarClient(client: SidecarClient): Promise<void> {
    const old = this.sidecarClient;
    this.connectToSidecar(client);
    old?.disconnect();
    // Answered after every frame sent before it, on the same socket
    const info = await client.listSessionsInfo().catch(() => null);
    const sent = new Map(info?.map((i) => [i.id, i.seq]));
    const live = [...this.sessions.values()].filter(
      (s) => s.mode === "sidecar" && s.alive && !this.reattaching.has(s.id),
    );
    const lost = live.filter((s) => !info || lostFrames(s.lastSeq, sent.get(s.id), !!s.seqGap));
    logger.info(
      `[Sidecar] swap: ${live.length - lost.length} session(s) exact by seq, ${lost.length} rebuilt from the ring`,
    );
    await Promise.all(
      lost.map((s) => resyncFromRing(s, client, () => this.sessions.get(s.id) === s)),
    );
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

  /** With alive + exit info: the sidecar keeps dead sessions 60s, and crash recovery must not
   *  read them as running */
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

  private reattachHost(): ReattachHost {
    return {
      sessions: this.sessions,
      reattaching: this.reattaching,
      pendingSizes: this.pendingSizes,
      outputWatchers: this.outputWatchers,
      client: () => this.sidecarClient,
      applyFrame: (s, data, seq) => this.applyFrame(s, data, seq),
      finishExit: (s, code, signal) => this.finishExit(s, code, signal),
      resize: (id, cols, rows) => this.resize(id, cols, rows),
      redraw: (id) => this.redraw(id),
    };
  }

  /** Reattach to a session that survived in the sidecar after app restart */
  reattachSession(
    id: string,
    spawnOpts: { cols: number; rows: number },
    callbacks: SessionCallbacks,
    options?: ReattachOptions,
  ): Promise<ReattachedSession | null> {
    return reattachSidecarSession(this.reattachHost(), id, spawnOpts, callbacks, options);
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
    return this.spawnSlot(() => this.doCreateLegacy(id, spawnOpts, callbacks, options));
  }

  private async doCreateSidecar(
    id: string,
    spawnOpts: SpawnPayload,
    callbacks: SessionCallbacks,
    options?: { scrollbackPath?: string; shellReadyGating?: boolean; smallRingBuffer?: boolean },
  ): Promise<{ pid: number }> {
    const session = newSidecarSession(
      id,
      spawnOpts,
      callbacks,
      options?.scrollbackPath,
      options?.shellReadyGating ? "pending" : "unsupported",
    );
    session.lastSeq = 0;
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
    noteSessionActivity(id, "input");
    if (s.shellReadyState === "pending") {
      if (data.startsWith("\x1b")) return;
      s.preReadyStdinQueue.push(data);
      return;
    }
    this.sendNow(s, data);
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
    return this.exitWaiters.wait(id, timeoutMs);
  }

  listSessions(): string[] {
    return Array.from(this.sessions.keys());
  }

  destroyAll(): void {
    for (const [, session] of this.sessions) {
      forceKillSession(session, this.sidecarClient);
    }
    this.sessions.clear();
    this.exitWaiters.notifyAll();
  }

  // ─── Private ──────────────────────────────────────────────────────────

  private resolveShellReady(session: Session, state: "ready" | "timed_out"): void {
    resolveShellReady(session, state, (data) => this.sendNow(session, data));
  }

  /** A write past the shell-ready gate */
  private sendNow(s: Session, data: string): void {
    if (s.mode === "sidecar") {
      this.callSidecar("session.write", s.id, (c) => c.write(s.id, data));
      return;
    }
    try {
      s.child?.stdin?.write(encodeString(FRAME_WRITE, data));
    } catch {
      /* pipe broken */
    }
  }

  private endSession(s: Session): void {
    s.alive = false;
    flushScrollbackSync(s);
    this.cleanup(s.id);
  }

  private cleanup(id: string): void {
    const session = this.sessions.get(id);
    if (!session) return;
    if (session.flushTimer) clearTimeout(session.flushTimer);
    if (session.shellReadyTimeout) clearTimeout(session.shellReadyTimeout);
    flushScrollbackSync(session);
    session.emulator.dispose();
    this.sessions.delete(id);
    this.pendingSizes.delete(id);
    this.exitWaiters.notify(id);
  }
}

// ─── Singleton ──────────────────────────────────────────────────────────

let instance: PtyHost | null = null;

export function getPtyHost(): PtyHost {
  if (!instance) instance = new PtyHost();
  return instance;
}
