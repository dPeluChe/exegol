// PTY Sidecar — standalone detached process.
// Runs with ELECTRON_RUN_AS_NODE=1, survives window reloads.
// Manages all PTY sessions via JSON-RPC over Unix domain socket.

import { mkdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { createServer, type Socket } from "node:net";
import * as pty from "node-pty";
import { createNdjsonBuffer } from "../lib/ndjson";
import {
  clearHistory,
  computeMemoryInfo,
  evictIfOverCap,
  reloadIfEvicted,
} from "./pty-sidecar-eviction";
import { appendPending, FLUSH_INTERVAL_MS, OutputGate } from "./pty-sidecar-flusher";
import {
  EXEGOL_DIR,
  GLOBAL_RING_BUFFER_CAP_BYTES,
  holdsLease,
  type JsonRpcMessage,
  type JsonRpcRequest,
  LEASE_CHECK_MS,
  makeNotification,
  makeResponse,
  type PidFile,
  parsePidFile,
  RING_BUFFER_CAPACITY,
  RING_BUFFER_EVICTION_SWEEP_MS,
  type SessionCreateParams,
  type SessionIdParams,
  type SessionResizeParams,
  type SessionWriteParams,
  SIDECAR_IDLE_TIMEOUT_MS,
  SIDECAR_PID_PATH,
  SIDECAR_SOCK_PATH,
  SIDECAR_VERSION,
} from "./pty-sidecar-protocol";
import { da1Replies, stripTerminalQueries } from "./pty-sidecar-queries";
import { RingBuffer } from "./ring-buffer";

// ─── Session state ──────────────────────────────────────────────────────

interface SidecarSession {
  id: string;
  pty: pty.IPty;
  ringBuffer: RingBuffer;
  pid: number;
  alive: boolean;
  exitCode: number | null;
  signal: string | null;
  /** T113: pending output coalesced for the next flush. */
  pending: string;
  pendingBytes: number;
  flushTimer: ReturnType<typeof setTimeout> | null;
  /** T143: last time this session produced PTY output (LRU eviction signal) */
  lastActivityAt: number;
  /** T143: set once this session's ring buffer content was evicted to disk */
  evictedPath: string | null;
}

const sessions = new Map<string, SidecarSession>();
const clients = new Set<Socket>();
const startTime = Date.now();
let idleTimer: ReturnType<typeof setTimeout> | null = null;

// T143: periodic ring buffer eviction sweep (see pty-sidecar-eviction.ts)
setInterval(() => evictIfOverCap(sessions.values()), RING_BUFFER_EVICTION_SWEEP_MS).unref();

// ─── Client management ──────────────────────────────────────────────────

const output = new OutputGate<Socket>((paused) => {
  for (const s of sessions.values()) {
    if (!s.alive) continue;
    if (paused) s.pty.pause();
    else s.pty.resume();
  }
});

function broadcast(msg: string): void {
  output.send(clients, msg);
}

function applyAppend(s: SidecarSession, data: string, bytes: number): void {
  const result = appendPending(s, data, bytes);
  s.pending = result.pending;
  s.pendingBytes = result.pendingBytes;
}

function flushSession(s: SidecarSession): void {
  if (s.flushTimer) {
    clearTimeout(s.flushTimer);
    s.flushTimer = null;
  }
  if (s.pending.length === 0) return;
  const data = s.pending;
  s.pending = "";
  s.pendingBytes = 0;
  broadcast(makeNotification("session.data", { id: s.id, data }));
}

function scheduleFlush(s: SidecarSession): void {
  if (s.flushTimer) return;
  s.flushTimer = setTimeout(() => flushSession(s), FLUSH_INTERVAL_MS);
}

function resetIdleTimer(): void {
  if (idleTimer) clearTimeout(idleTimer);
  if (sessions.size === 0 && clients.size === 0) {
    idleTimer = setTimeout(() => stopAndExit(0), SIDECAR_IDLE_TIMEOUT_MS);
  } else {
    idleTimer = null;
  }
}

// ─── RPC handlers ───────────────────────────────────────────────────────

function handleRequest(req: JsonRpcRequest, client: Socket): void {
  try {
    switch (req.method) {
      case "ping": {
        client.write(
          makeResponse(req.id, {
            version: SIDECAR_VERSION,
            uptime: Math.floor((Date.now() - startTime) / 1000),
            sessions: sessions.size,
          }),
        );
        break;
      }

      case "session.create": {
        const p = req.params as SessionCreateParams;
        if (sessions.has(p.id)) {
          client.write(
            makeResponse(req.id, undefined, { code: -1, message: "Session already exists" }),
          );
          break;
        }

        const proc = pty.spawn(p.shell, p.args, {
          name: "xterm-256color",
          cols: p.cols,
          rows: p.rows,
          cwd: p.cwd,
          env: p.env,
        });

        const ringBuffer = new RingBuffer(p.bufferCapacity ?? RING_BUFFER_CAPACITY);
        const session: SidecarSession = {
          id: p.id,
          pty: proc,
          ringBuffer,
          pid: proc.pid,
          alive: true,
          exitCode: null,
          signal: null,
          pending: "",
          pendingBytes: 0,
          flushTimer: null,
          lastActivityAt: Date.now(),
          evictedPath: null,
        };
        sessions.set(p.id, session);
        if (output.paused) proc.pause();

        proc.onData((data: string) => {
          reloadIfEvicted(session);
          const buf = Buffer.from(data, "utf-8");
          ringBuffer.write(buf);
          session.lastActivityAt = Date.now();
          // Nobody attached to answer: fish waits ~10s for its DA1 reply otherwise
          if (clients.size === 0) {
            const reply = da1Replies(data);
            if (reply) proc.write(reply);
          }
          applyAppend(session, data, buf.length);
          scheduleFlush(session);
        });

        proc.onExit(({ exitCode, signal }) => {
          flushSession(session);
          session.alive = false;
          session.exitCode = exitCode ?? null;
          session.signal = signal != null ? String(signal) : null;
          broadcast(makeNotification("session.exit", { id: p.id, exitCode, signal }));
          // Keep session in map for snapshot retrieval — cleanup after grace period
          setTimeout(() => {
            sessions.delete(p.id);
            resetIdleTimer();
          }, 60_000);
        });

        resetIdleTimer();
        client.write(makeResponse(req.id, { pid: proc.pid }));
        break;
      }

      case "session.write": {
        const { id, data } = req.params as SessionWriteParams;
        const s = sessions.get(id);
        if (!s?.alive) {
          client.write(
            makeResponse(req.id, undefined, { code: -1, message: "Session not found or dead" }),
          );
          break;
        }
        s.pty.write(data);
        client.write(makeResponse(req.id, { ok: true }));
        break;
      }

      case "session.resize": {
        const { id, cols, rows } = req.params as SessionResizeParams;
        const s = sessions.get(id);
        if (!s?.alive) break;
        s.pty.resize(cols, rows);
        client.write(makeResponse(req.id, { ok: true }));
        break;
      }

      case "session.kill": {
        const { id } = req.params as SessionIdParams;
        const s = sessions.get(id);
        if (!s?.alive) break;
        s.pty.kill();
        // Escalate to SIGKILL after 2s
        const pid = s.pid;
        setTimeout(() => {
          try {
            process.kill(pid, "SIGKILL");
          } catch {
            /* already dead */
          }
        }, 2000);
        client.write(makeResponse(req.id, { ok: true }));
        break;
      }

      case "session.destroy": {
        const { id } = req.params as SessionIdParams;
        const s = sessions.get(id);
        if (s) {
          flushSession(s);
          if (s.alive) {
            try {
              s.pty.kill();
            } catch {
              /* */
            }
          }
          sessions.delete(id);
          resetIdleTimer();
        }
        client.write(makeResponse(req.id, { ok: true }));
        break;
      }

      case "session.snapshot": {
        const { id } = req.params as SessionIdParams;
        const s = sessions.get(id);
        if (s) reloadIfEvicted(s);
        const data = s ? stripTerminalQueries(s.ringBuffer.snapshot().toString("utf-8")) : null;
        client.write(makeResponse(req.id, { data }));
        break;
      }

      case "session.clear": {
        const { id } = req.params as SessionIdParams;
        const s = sessions.get(id);
        if (s) clearHistory(s);
        client.write(makeResponse(req.id, { ok: true }));
        break;
      }

      case "session.list": {
        client.write(makeResponse(req.id, { sessions: Array.from(sessions.keys()) }));
        break;
      }

      case "session.listInfo": {
        const info = Array.from(sessions.values()).map((s) => ({
          id: s.id,
          alive: s.alive,
          exitCode: s.exitCode,
          signal: s.signal,
        }));
        client.write(makeResponse(req.id, { sessions: info }));
        break;
      }

      case "session.memory": {
        const { sessions: memInfo, totalCapacityBytes } = computeMemoryInfo(sessions.values());
        client.write(
          makeResponse(req.id, {
            sessions: memInfo,
            totalCapacityBytes,
            globalCapBytes: GLOBAL_RING_BUFFER_CAP_BYTES,
          }),
        );
        break;
      }

      case "shutdown": {
        client.write(makeResponse(req.id, { ok: true }));
        stopAndExit(500);
        break;
      }

      default:
        client.write(
          makeResponse(req.id, undefined, {
            code: -32601,
            message: `Unknown method: ${req.method}`,
          }),
        );
    }
  } catch (err) {
    client.write(makeResponse(req.id, undefined, { code: -32603, message: String(err) }));
  }
}

// ─── Socket server ──────────────────────────────────────────────────────

const server = createServer((client: Socket) => {
  clients.add(client);
  resetIdleTimer();

  const feed = createNdjsonBuffer<JsonRpcMessage>(
    (msg) => {
      // Responses from the client are not expected; ignore them
      if ("id" in msg && "method" in msg) handleRequest(msg as JsonRpcRequest, client);
    },
    () => process.stderr.write("[Sidecar] Client sent an oversized frame, discarding\n"),
  );
  client.on("data", feed);

  const drop = () => {
    clients.delete(client);
    output.release(client);
    resetIdleTimer();
  };
  client.on("close", drop);
  client.on("error", drop);
});

// ─── Startup ────────────────────────────────────────────────────────────

/** Discovery's identity for this sidecar; the pid file naming it is our lease (holdsLease). */
const TOKEN = process.env.EXEGOL_SIDECAR_TOKEN ?? "";

/** Inode of the socket file our listen() created. */
let socketIno: number | null = null;

/** The pid file's text; null when it is gone, undefined when it could not be read (no evidence). */
function readPidFileText(): string | null | undefined {
  try {
    return readFileSync(SIDECAR_PID_PATH, "utf-8");
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "ENOENT" ? null : undefined;
  }
}

/** Remove our pid file and socket, never a successor's (2026-08-13: an exiting predecessor
 *  deleted the replacement's files and orphaned it). */
function cleanup(): void {
  try {
    if (parsePidFile(readPidFileText())?.token === TOKEN) unlinkSync(SIDECAR_PID_PATH);
    if (socketIno !== null && statSync(SIDECAR_SOCK_PATH).ino === socketIno) {
      unlinkSync(SIDECAR_SOCK_PATH);
    }
  } catch {
    /* already gone */
  }
}

function start(): void {
  mkdirSync(EXEGOL_DIR, { recursive: true });
  try {
    unlinkSync(SIDECAR_SOCK_PATH);
  } catch {
    /* no stale socket */
  }

  server.listen(SIDECAR_SOCK_PATH, () => {
    socketIno = statSync(SIDECAR_SOCK_PATH).ino;
    const pidFile: PidFile = {
      pid: process.pid,
      token: TOKEN,
      version: SIDECAR_VERSION,
      sock: SIDECAR_SOCK_PATH,
    };
    writeFileSync(SIDECAR_PID_PATH, JSON.stringify(pidFile), "utf-8");
    resetIdleTimer();
    const lease = setInterval(() => {
      if (holdsLease(readPidFileText(), TOKEN)) return;
      process.stderr.write("[Sidecar] Replaced (pid file no longer names this sidecar), exiting\n");
      clearInterval(lease);
      stopAndExit(2000);
    }, LEASE_CHECK_MS);
    lease.unref();
  });

  server.on("error", (err) => {
    process.stderr.write(`[Sidecar] Server error: ${err.message}\n`);
    cleanup();
    process.exit(1);
  });
}

// ─── Signal handling ────────────────────────────────────────────────────

/**
 * Kill every session and exit. Pending output is flushed first: onExit may not fire before the
 * SIGKILL escalation, and clients may disconnect meanwhile, stranding the last <4 ms of output.
 */
function stopAndExit(graceMs: number): void {
  for (const s of sessions.values()) {
    flushSession(s);
    if (!s.alive) continue;
    try {
      s.pty.kill();
    } catch {
      /* */
    }
  }
  setTimeout(() => {
    for (const s of sessions.values()) {
      if (!s.alive) continue;
      try {
        process.kill(s.pid, "SIGKILL");
      } catch {
        /* */
      }
    }
    cleanup();
    process.exit(0);
  }, graceMs);
}

process.on("SIGTERM", () => stopAndExit(2000));

process.on("uncaughtException", (err) => {
  process.stderr.write(`[Sidecar] Uncaught: ${err.message}\n`);
});

start();
