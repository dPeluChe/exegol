// PTY Host — manages PTY subprocess sessions from the main process (T35+T36+T37).
import { logger } from "../lib/logger";
import { HeadlessEmulator, type SessionSnapshot } from "./headless-emulator";
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

export type { SessionCallbacks } from "./pty-session-types";

export class PtyHost {
  private sessions = new Map<string, Session>();
  private activeSpawns = 0;
  private spawnQueue: Array<() => void> = [];
  private sidecarClient: SidecarClient | null = null;

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
        scheduleScrollbackFlush(s);
        s.callbacks.onData(processedData);
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

  /** Reattach to a session that survived in the sidecar after app restart */
  async reattachSession(
    id: string,
    spawnOpts: { cols: number; rows: number },
    callbacks: SessionCallbacks,
    options?: { scrollbackPath?: string },
  ): Promise<void> {
    if (!this.sidecarClient?.isConnected()) return;

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

    // Replay ring buffer snapshot to rebuild emulator state
    try {
      const snapshot = await this.sidecarClient.snapshot(id);
      if (snapshot) {
        emulator.write(snapshot);
        callbacks.onData(snapshot);
      }
    } catch {
      // Snapshot unavailable — session still reattaches, just without scrollback history
    }
  }

  /** Create a new PTY session — uses sidecar if available, falls back to subprocess */
  async createSession(
    id: string,
    spawnOpts: SpawnPayload,
    callbacks: SessionCallbacks,
    options?: { scrollbackPath?: string; shellReadyGating?: boolean },
  ): Promise<{ pid: number }> {
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
    options?: { scrollbackPath?: string; shellReadyGating?: boolean },
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
      this.sidecarClient?.write(id, data).catch(() => {});
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
    if (!s?.alive) return;
    s.emulator.resize(cols, rows);
    if (s.mode === "sidecar") {
      this.sidecarClient?.resize(id, cols, rows).catch(() => {});
      return;
    }
    try {
      s.child?.stdin?.write(encodeJson(FRAME_RESIZE, { cols, rows }));
    } catch {
      /* pipe broken */
    }
  }

  kill(id: string): void {
    const s = this.sessions.get(id);
    if (!s?.alive) return;
    if (s.mode === "sidecar") {
      this.sidecarClient?.kill(id).catch(() => {});
      return;
    }
    try {
      s.child?.stdin?.write(encodeFrame(FRAME_KILL, Buffer.alloc(0)));
    } catch {
      /* pipe broken */
    }
  }

  getSnapshot(id: string): string | null {
    return this.sessions.get(id)?.emulator.snapshot() ?? null;
  }

  /** Full session snapshot for reattach protocol (modes + rehydrate sequences + CWD) */
  getSessionSnapshot(id: string): SessionSnapshot | null {
    return this.sessions.get(id)?.emulator.sessionSnapshot() ?? null;
  }

  getCwd(id: string): string | null {
    return this.sessions.get(id)?.emulator.cwd ?? null;
  }

  isAlive(id: string): boolean {
    return this.sessions.get(id)?.alive ?? false;
  }

  getPid(id: string): number | null {
    return this.sessions.get(id)?.pid ?? null;
  }

  hasSession(id: string): boolean {
    return this.sessions.has(id);
  }

  listSessions(): string[] {
    return Array.from(this.sessions.keys());
  }

  destroyAll(): void {
    for (const [, session] of this.sessions) {
      this.forceKillSession(session);
    }
    this.sessions.clear();
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
        this.sidecarClient?.write(session.id, data).catch(() => {});
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
