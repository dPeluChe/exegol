// PTY Host — manages PTY subprocess sessions from the main process (T35+T36+T37).
// Each agent gets a dedicated child process with binary IPC.
// Integrates headless emulator for state recovery and async scrollback persistence.

import { type ChildProcess, spawn as cpSpawn } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { logger } from "../lib/logger";
import { HeadlessEmulator } from "./headless-emulator";
import {
  type ExitPayload,
  encodeFrame,
  encodeJson,
  encodeString,
  FRAME_DATA,
  FRAME_DISPOSE,
  FRAME_ERROR,
  FRAME_EXIT,
  FRAME_KILL,
  FRAME_READY,
  FRAME_RESIZE,
  FRAME_SPAWN,
  FRAME_SPAWNED,
  FRAME_WRITE,
  FrameDecoder,
  type SpawnedPayload,
  type SpawnPayload,
} from "./pty-ipc";
import { SHELL_READY_MARKER } from "./shell-wrappers";

/** Resolve the subprocess JS file path. Handles both dev and prod output structures. */
function resolveSubprocessPath(): string {
  // Primary: same directory as the main bundle (rollupOptions.input output)
  const primary = join(__dirname, "pty-subprocess.js");
  if (existsSync(primary)) return primary;
  // Fallback: nested under terminal/ (in case bundler preserves directory structure)
  const nested = join(__dirname, "terminal", "pty-subprocess.js");
  if (existsSync(nested)) return nested;
  // Last resort: use primary path and let spawn fail with a clear error
  logger.warn(`[PtyHost] Subprocess not found at ${primary} or ${nested}, spawn will likely fail`);
  return primary;
}

const MAX_CONCURRENT_SPAWNS = 3;
const SCROLLBACK_THROTTLE_MS = 5_000; // Write snapshot at most every 5s
const SUBPROCESS_READY_TIMEOUT_MS = 10_000;
const SHELL_READY_TIMEOUT_MS = 15_000; // Wait for marker before unblocking writes

type ShellReadyState = "pending" | "ready" | "timed_out" | "unsupported";

export interface SessionCallbacks {
  onData: (data: string) => void;
  onExit: (exitCode: number, signal?: number) => void;
  onError: (message: string) => void;
}

interface Session {
  id: string;
  child: ChildProcess;
  decoder: FrameDecoder;
  emulator: HeadlessEmulator;
  pid: number | null;
  alive: boolean;
  callbacks: SessionCallbacks;
  scrollbackPath: string | null;
  flushTimer: ReturnType<typeof setTimeout> | null;
  // Shell readiness gating (Mejora A)
  shellReadyState: ShellReadyState;
  preReadyStdinQueue: string[];
  markerMatchPos: number;
  markerHeldBytes: string;
  shellReadyTimeout: ReturnType<typeof setTimeout> | null;
}

export class PtyHost {
  private sessions = new Map<string, Session>();
  private activeSpawns = 0;
  private spawnQueue: Array<() => void> = [];

  /** Create a new PTY session in a subprocess */
  async createSession(
    id: string,
    spawnOpts: SpawnPayload,
    callbacks: SessionCallbacks,
    options?: { scrollbackPath?: string; shellReadyGating?: boolean },
  ): Promise<{ pid: number }> {
    await this.acquireSpawnSlot();
    try {
      return await this.doCreate(id, spawnOpts, callbacks, options);
    } finally {
      this.releaseSpawnSlot();
    }
  }

  write(id: string, data: string): void {
    const s = this.sessions.get(id);
    if (!s?.alive) return;
    // Shell readiness gating: buffer writes during pending state
    if (s.shellReadyState === "pending") {
      // Drop escape sequences (stale terminal query responses)
      if (data.startsWith("\x1b")) return;
      s.preReadyStdinQueue.push(data);
      return;
    }
    try {
      s.child.stdin?.write(encodeString(FRAME_WRITE, data));
    } catch {
      /* pipe broken */
    }
  }

  resize(id: string, cols: number, rows: number): void {
    const s = this.sessions.get(id);
    if (!s?.alive) return;
    s.emulator.resize(cols, rows);
    try {
      s.child.stdin?.write(encodeJson(FRAME_RESIZE, { cols, rows }));
    } catch {
      /* pipe broken */
    }
  }

  kill(id: string): void {
    const s = this.sessions.get(id);
    if (!s?.alive) return;
    try {
      s.child.stdin?.write(encodeFrame(FRAME_KILL, Buffer.alloc(0)));
    } catch {
      /* pipe broken */
    }
  }

  getSnapshot(id: string): string | null {
    return this.sessions.get(id)?.emulator.snapshot() ?? null;
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
    this.flushScrollbackSync(session);
    // Try graceful dispose first
    try {
      session.child.stdin?.write(encodeFrame(FRAME_DISPOSE, Buffer.alloc(0)));
    } catch {
      /* pipe closed */
    }
    // Safety net: SIGKILL after 1s if subprocess hasn't exited
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
    if (session.flushTimer) clearTimeout(session.flushTimer);
    session.emulator.dispose();
  }

  // ─── Private ──────────────────────────────────────────────────────────

  private doCreate(
    id: string,
    spawnOpts: SpawnPayload,
    callbacks: SessionCallbacks,
    options?: { scrollbackPath?: string; shellReadyGating?: boolean },
  ): Promise<{ pid: number }> {
    return new Promise((resolve, reject) => {
      const subprocessPath = resolveSubprocessPath();

      const child = cpSpawn(process.execPath, [subprocessPath], {
        env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
        stdio: ["pipe", "pipe", "inherit"],
      });

      const emulator = new HeadlessEmulator(spawnOpts.cols, spawnOpts.rows);
      const decoder = new FrameDecoder();
      const session: Session = {
        id,
        child,
        decoder,
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

      // Start shell readiness timeout
      if (session.shellReadyState === "pending") {
        session.shellReadyTimeout = setTimeout(() => {
          this.resolveShellReady(session, "timed_out");
        }, SHELL_READY_TIMEOUT_MS);
      }

      let readyReceived = false;
      let resolved = false;

      child.stdout?.on("data", (chunk: Buffer) => {
        for (const { type, payload } of decoder.decode(chunk)) {
          switch (type) {
            case FRAME_READY:
              if (!readyReceived) {
                readyReceived = true;
                child.stdin?.write(encodeJson(FRAME_SPAWN, spawnOpts));
              }
              break;

            case FRAME_SPAWNED: {
              const { pid } = JSON.parse(payload.toString()) as SpawnedPayload;
              session.pid = pid;
              resolved = true;
              resolve({ pid });
              break;
            }

            case FRAME_DATA: {
              let data = payload.toString("utf-8");

              // Scan for shell-ready marker character-by-character.
              // Matching bytes are held back; on full match they're discarded
              // and readiness resolves. On mismatch they're flushed as output.
              if (session.shellReadyState === "pending") {
                let output = "";
                for (let i = 0; i < data.length; i++) {
                  if (data[i] === SHELL_READY_MARKER[session.markerMatchPos]) {
                    session.markerHeldBytes += data[i];
                    session.markerMatchPos++;
                    if (session.markerMatchPos === SHELL_READY_MARKER.length) {
                      // Full match — discard held bytes, resolve readiness
                      session.markerHeldBytes = "";
                      session.markerMatchPos = 0;
                      this.resolveShellReady(session, "ready");
                      output += data.slice(i + 1);
                      break;
                    }
                  } else {
                    // Mismatch — flush held bytes as regular output
                    output += session.markerHeldBytes + data[i];
                    session.markerHeldBytes = "";
                    session.markerMatchPos = 0;
                  }
                }
                data = output;
              }

              if (data.length > 0) {
                emulator.write(data);
                this.scheduleScrollbackFlush(session);
                callbacks.onData(data);
              }
              break;
            }

            case FRAME_EXIT: {
              const { exitCode, signal } = JSON.parse(payload.toString()) as ExitPayload;
              session.alive = false;
              this.flushScrollbackSync(session);
              this.cleanup(id);
              callbacks.onExit(exitCode, signal);
              break;
            }

            case FRAME_ERROR: {
              const { message } = JSON.parse(payload.toString()) as { message: string };
              callbacks.onError(message);
              if (!resolved) {
                resolved = true;
                this.cleanup(id);
                reject(new Error(message));
              }
              break;
            }
          }
        }
      });

      child.on("exit", (code) => {
        if (session.alive) {
          session.alive = false;
          this.flushScrollbackSync(session);
          this.cleanup(id);
          callbacks.onExit(code ?? 1);
        }
        if (!resolved) {
          resolved = true;
          reject(new Error(`PTY subprocess exited with code ${code} before spawning`));
        }
      });

      child.on("error", (err) => {
        if (session.alive) {
          session.alive = false;
          this.cleanup(id);
          callbacks.onError(err.message);
        }
        if (!resolved) {
          resolved = true;
          reject(err);
        }
      });

      setTimeout(() => {
        if (!resolved) {
          resolved = true;
          // Kill the child process — it's stuck
          try {
            child.kill("SIGKILL");
          } catch {
            /* */
          }
          this.cleanup(id);
          reject(new Error("PTY subprocess did not become ready within 10s"));
        }
      }, SUBPROCESS_READY_TIMEOUT_MS);
    });
  }

  // ── Shell readiness resolution ─────────────────────────────────────────

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
      try {
        session.child.stdin?.write(encodeString(FRAME_WRITE, data));
      } catch {
        /* pipe broken */
      }
    }
    if (state === "timed_out") {
      logger.warn(`[PtyHost] Shell ready marker timed out for ${session.id} — unblocking writes`);
    }
  }

  // ── Scrollback persistence (T37: async throttled writes) ──────────────

  private scheduleScrollbackFlush(session: Session): void {
    if (!session.scrollbackPath || session.flushTimer) return;
    session.flushTimer = setTimeout(() => {
      session.flushTimer = null;
      this.flushScrollbackAsync(session);
    }, SCROLLBACK_THROTTLE_MS);
  }

  private async flushScrollbackAsync(session: Session): Promise<void> {
    if (!session.scrollbackPath) return;
    const snapshot = session.emulator.snapshot();
    if (!snapshot) return;
    try {
      await mkdir(dirname(session.scrollbackPath), { recursive: true });
      await writeFile(session.scrollbackPath, snapshot, "utf-8");
    } catch (err) {
      logger.error(`[PtyHost] Scrollback write failed for ${session.id}:`, err);
    }
  }

  /** Synchronous flush for exit paths — guarantees write completes before process exits */
  private flushScrollbackSync(session: Session): void {
    if (!session.scrollbackPath) return;
    const snapshot = session.emulator.snapshot();
    if (!snapshot) return;
    try {
      mkdirSync(dirname(session.scrollbackPath), { recursive: true });
      writeFileSync(session.scrollbackPath, snapshot, "utf-8");
    } catch (err) {
      logger.error(`[PtyHost] Sync scrollback write failed for ${session.id}:`, err);
    }
  }

  // ── Session cleanup ───────────────────────────────────────────────────

  private cleanup(id: string): void {
    const session = this.sessions.get(id);
    if (!session) return;
    if (session.flushTimer) clearTimeout(session.flushTimer);
    if (session.shellReadyTimeout) clearTimeout(session.shellReadyTimeout);
    // Flush BEFORE dispose — snapshot needs the emulator alive
    this.flushScrollbackSync(session);
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
