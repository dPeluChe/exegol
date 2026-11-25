// PTY Host — manages PTY subprocess sessions from the main process (T35+T36+T37).
import type { LiveSnapshot, ScreenDialog } from "@exegol/shared";
import { noteSessionActivity } from "../agents/session-activity";
import { createLimiter } from "../lib/concurrency";
import { logger } from "../lib/logger";
import { terminalProcesses, terminateAll } from "../system/process-tree";
import { readProcessTable } from "../system/shell-clis";
import { ExitWaiters } from "./exit-waiters";
import type { HeadlessEmulator } from "./headless-emulator";
import { SidecarLossHandler } from "./pty-host-loss";
import {
  type ReattachedSession,
  type ReattachHost,
  type ReattachOptions,
  reattachSidecarSession,
} from "./pty-host-reattach";
import type { SpawnPayload } from "./pty-ipc";
import { doCreateLegacy, forceKillSession, type LegacyHostDeps } from "./pty-legacy-session";
import * as screen from "./pty-screen-reads";
import { flushScrollbackSync, scheduleScrollbackFlush } from "./pty-scrollback";
import { callSidecar, killPty, resizePty, sendNow } from "./pty-session-io";
import { MAX_CONCURRENT_SPAWNS, type Session, type SessionCallbacks } from "./pty-session-types";
import { resolveShellReady, scanForMarker } from "./pty-shell-ready";
import type { SidecarClient } from "./pty-sidecar-client";
import { doCreateSidecar } from "./pty-sidecar-create";
import type { SessionMemoryResult } from "./pty-sidecar-protocol";
import { isFrameGap, isStaleFrame, lostFrames, resyncFromRing } from "./sidecar-resync";

export type { ReattachedSession } from "./pty-host-reattach";
export type { SessionCallbacks } from "./pty-session-types";

/** Redraws asked within this of the last one are the same repaint */
const REDRAW_WINDOW_MS = 500;

export class PtyHost {
  private sessions = new Map<string, Session>();
  /** A pane can mount (and size itself) before its session is reattached;
   *  that size was dropped, so the PTY kept its old grid until the next resize */
  private pendingSizes = new Map<string, { cols: number; rows: number }>();
  private lastRedrawAt = new Map<string, number>();
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
      s.callbacks.onData(processedData, s.lastSeq);
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
      return doCreateSidecar(
        this.sidecarClient,
        this.sessions,
        (s, st) => this.resolveShellReady(s, st),
        id,
        spawnOpts,
        callbacks,
        options,
      );
    }
    return this.spawnSlot(() => this.doCreateLegacy(id, spawnOpts, callbacks, options));
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
    sendNow(this.sidecarClient, s, data);
  }

  resize(id: string, cols: number, rows: number): void {
    const s = this.sessions.get(id);
    if (!s || this.reattaching.has(id)) {
      this.pendingSizes.set(id, { cols, rows });
      return;
    }
    if (!s.alive) return;
    s.emulator.resize(cols, rows);
    resizePty(this.sidecarClient, s, cols, rows);
  }

  /** Make the CLI repaint at its current size: a size change is the only
   *  signal every TUI honours. The model keeps its real grid throughout. */
  redraw(id: string): void {
    const s = this.sessions.get(id);
    if (!s?.alive) return;
    // One repaint per burst: pane and mirror both ask on Refresh or a GPU repaint, and a view's
    // mount kick lands right after the reattach's own redraw
    const now = Date.now();
    if (now - (this.lastRedrawAt.get(id) ?? 0) < REDRAW_WINDOW_MS) return;
    const { cols, rows } = s.emulator.size;
    if (cols < 3) return;
    this.lastRedrawAt.set(id, now);
    resizePty(this.sidecarClient, s, cols - 1, rows);
    setTimeout(() => {
      if (s.alive) resizePty(this.sidecarClient, s, s.emulator.size.cols, s.emulator.size.rows);
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

  /** Ends the session and what it started (`terminalProcesses`), read while the shell still holds
   *  it: once the shell dies its children are reparented and its tty released */
  kill(id: string): void {
    const s = this.sessions.get(id);
    if (!s?.alive) return;
    // Windows reads the table through PowerShell (a second or more) and keeps a dead parent's
    // pid on its children, so the pane closes first there and the tree is read after
    const first = process.platform === "win32";
    if (first) killPty(this.sidecarClient, s);
    const read = s.pid ? readProcessTable().catch(() => []) : Promise.resolve([]);
    void read.then((rows) => {
      const started = s.pid ? terminalProcesses(s.pid, rows) : [];
      if (!first) killPty(this.sidecarClient, s);
      terminateAll(started);
    });
  }

  /** Kill a sidecar session that has no local `sessions` entry (orphan sweep).
   *  `kill()` no-ops for unmapped ids, which left zombies alive across restarts. */
  killUnclaimed(id: string): void {
    callSidecar(this.sidecarClient, "session.kill", id, (c) => c.kill(id));
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

  parsedLiveSnapshot(id: string): Promise<LiveSnapshot | null> {
    return screen.parsedLiveSnapshot(this.sessions, id);
  }

  screenDialog(id: string): ScreenDialog | null {
    return screen.screenDialog(this.sessions, id);
  }

  screenGate(id: string): boolean {
    return screen.screenGate(this.sessions, id);
  }

  holdsEnter(id: string): boolean {
    return screen.holdsEnter(this.sessions, id);
  }

  textLines(id: string): ReturnType<HeadlessEmulator["textLines"]> | null {
    return screen.textLines(this.sessions, id);
  }

  markTurn(id: string): void {
    this.sessions.get(id)?.emulator.markTurn();
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
    resolveShellReady(session, state, (data) => sendNow(this.sidecarClient, session, data));
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
    this.lastRedrawAt.delete(id);
    this.exitWaiters.notify(id);
  }
}

// ─── Singleton ──────────────────────────────────────────────────────────

let instance: PtyHost | null = null;

export function getPtyHost(): PtyHost {
  if (!instance) instance = new PtyHost();
  return instance;
}
