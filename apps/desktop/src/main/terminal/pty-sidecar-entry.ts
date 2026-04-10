// PTY Sidecar — standalone detached process.
// Runs with ELECTRON_RUN_AS_NODE=1, survives window reloads.
// Manages all PTY sessions via JSON-RPC over Unix domain socket.

import { existsSync, mkdirSync, unlinkSync, writeFileSync } from "node:fs";
import { createServer, type Socket } from "node:net";
import { dirname } from "node:path";
import * as pty from "node-pty";
import {
  EXEGOL_DIR,
  type JsonRpcMessage,
  type JsonRpcRequest,
  makeNotification,
  makeResponse,
  type PidFile,
  RING_BUFFER_CAPACITY,
  type SessionCreateParams,
  type SessionIdParams,
  type SessionResizeParams,
  type SessionWriteParams,
  SIDECAR_IDLE_TIMEOUT_MS,
  SIDECAR_PID_PATH,
  SIDECAR_SOCK_PATH,
  SIDECAR_VERSION,
} from "./pty-sidecar-protocol";
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
}

const sessions = new Map<string, SidecarSession>();
const clients = new Set<Socket>();
const startTime = Date.now();
let idleTimer: ReturnType<typeof setTimeout> | null = null;

// ─── Client management ──────────────────────────────────────────────────

function broadcast(msg: string): void {
  for (const client of clients) {
    try {
      client.write(msg);
    } catch {
      /* dead client */
    }
  }
}

function resetIdleTimer(): void {
  if (idleTimer) clearTimeout(idleTimer);
  if (sessions.size === 0 && clients.size === 0) {
    idleTimer = setTimeout(() => {
      cleanup();
      process.exit(0);
    }, SIDECAR_IDLE_TIMEOUT_MS);
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

        const ringBuffer = new RingBuffer(RING_BUFFER_CAPACITY);
        const session: SidecarSession = {
          id: p.id,
          pty: proc,
          ringBuffer,
          pid: proc.pid,
          alive: true,
          exitCode: null,
          signal: null,
        };
        sessions.set(p.id, session);

        proc.onData((data: string) => {
          const buf = Buffer.from(data, "utf-8");
          ringBuffer.write(buf);
          broadcast(makeNotification("session.data", { id: p.id, data }));
        });

        proc.onExit(({ exitCode, signal }) => {
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
        const data = s ? s.ringBuffer.snapshot().toString("utf-8") : null;
        client.write(makeResponse(req.id, { data }));
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

      case "shutdown": {
        client.write(makeResponse(req.id, { ok: true }));
        // Kill all sessions, then exit
        for (const [, s] of sessions) {
          if (s.alive) {
            try {
              s.pty.kill();
            } catch {
              /* */
            }
          }
        }
        setTimeout(() => {
          cleanup();
          process.exit(0);
        }, 500);
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

  let buffer = "";

  client.on("data", (chunk: Buffer) => {
    buffer += chunk.toString("utf-8");
    // Process newline-delimited JSON-RPC messages
    for (;;) {
      const newlineIdx = buffer.indexOf("\n");
      if (newlineIdx === -1) break;
      const line = buffer.slice(0, newlineIdx);
      buffer = buffer.slice(newlineIdx + 1);
      if (!line.trim()) continue;
      try {
        const msg = JSON.parse(line) as JsonRpcMessage;
        if ("id" in msg && "method" in msg) {
          handleRequest(msg as JsonRpcRequest, client);
        }
        // Responses from client (not expected) — ignore
      } catch {
        // Malformed JSON — skip
      }
    }
  });

  client.on("close", () => {
    clients.delete(client);
    resetIdleTimer();
  });

  client.on("error", () => {
    clients.delete(client);
    resetIdleTimer();
  });
});

// ─── Startup ────────────────────────────────────────────────────────────

function cleanup(): void {
  try {
    unlinkSync(SIDECAR_SOCK_PATH);
  } catch {
    /* */
  }
  try {
    unlinkSync(SIDECAR_PID_PATH);
  } catch {
    /* */
  }
}

function start(): void {
  // Ensure directory exists
  mkdirSync(EXEGOL_DIR, { recursive: true });

  // Remove stale socket
  if (existsSync(SIDECAR_SOCK_PATH)) {
    try {
      unlinkSync(SIDECAR_SOCK_PATH);
    } catch {
      /* */
    }
  }

  // Ensure parent dir for socket exists
  mkdirSync(dirname(SIDECAR_SOCK_PATH), { recursive: true });

  server.listen(SIDECAR_SOCK_PATH, () => {
    // Write PID file
    const token = process.env.EXEGOL_SIDECAR_TOKEN ?? "";
    const pidFile: PidFile = {
      pid: process.pid,
      token,
      version: SIDECAR_VERSION,
      sock: SIDECAR_SOCK_PATH,
    };
    writeFileSync(SIDECAR_PID_PATH, JSON.stringify(pidFile), "utf-8");
    resetIdleTimer();
  });

  server.on("error", (err) => {
    process.stderr.write(`[Sidecar] Server error: ${err.message}\n`);
    cleanup();
    process.exit(1);
  });
}

// ─── Signal handling ────────────────────────────────────────────────────

process.on("SIGTERM", () => {
  for (const [, s] of sessions) {
    if (s.alive) {
      try {
        s.pty.kill();
      } catch {
        /* */
      }
    }
  }
  setTimeout(() => {
    // SIGKILL any remaining
    for (const [, s] of sessions) {
      if (s.alive) {
        try {
          process.kill(s.pid, "SIGKILL");
        } catch {
          /* */
        }
      }
    }
    cleanup();
    process.exit(0);
  }, 2000);
});

process.on("uncaughtException", (err) => {
  process.stderr.write(`[Sidecar] Uncaught: ${err.message}\n`);
});

start();
