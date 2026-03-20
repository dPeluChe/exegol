// PTY Subprocess — standalone entry point.
// Runs as child process with ELECTRON_RUN_AS_NODE=1.
// Owns a single node-pty instance, communicates via binary framing on stdin/stdout.

import * as pty from "node-pty";
import {
  type ExitPayload,
  encodeFrame,
  encodeJson,
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
  type ResizePayload,
  type SpawnPayload,
} from "./pty-ipc";

const OUTPUT_FLUSH_SIZE = 128 * 1024; // 128KB batch threshold
const KILL_ESCALATION_MS = 2000;

let proc: pty.IPty | null = null;
const outputBatch: Buffer[] = [];
let outputSize = 0;
let flushPending = false;
let stdoutPaused = false; // Backpressure: true when stdout buffer is full
const decoder = new FrameDecoder();

function send(type: number, data: Buffer): boolean {
  return process.stdout.write(encodeFrame(type, data));
}

function sendJson(type: number, obj: unknown): boolean {
  return process.stdout.write(encodeJson(type, obj));
}

function flushOutput(): void {
  flushPending = false;
  if (outputBatch.length === 0) return;
  const combined = Buffer.concat(outputBatch);
  outputBatch.length = 0;
  outputSize = 0;
  const canWrite = send(FRAME_DATA, combined);
  // Backpressure: pause PTY if stdout buffer is full
  if (!canWrite && proc && !stdoutPaused) {
    stdoutPaused = true;
    proc.pause();
  }
}

// Resume PTY when stdout drains
process.stdout.on("drain", () => {
  if (stdoutPaused && proc) {
    stdoutPaused = false;
    proc.resume();
  }
});

function scheduleFlush(): void {
  if (!flushPending) {
    flushPending = true;
    setImmediate(flushOutput);
  }
}

// ── Frame handler ───────────────────────────────────────────────────────

process.stdin.on("data", (chunk: Buffer) => {
  for (const { type, payload } of decoder.decode(chunk)) {
    switch (type) {
      case FRAME_SPAWN: {
        if (proc) {
          sendJson(FRAME_ERROR, { message: "Already spawned" });
          break;
        }
        const opts = JSON.parse(payload.toString("utf-8")) as SpawnPayload;
        try {
          proc = pty.spawn(opts.shell, opts.args, {
            name: "xterm-256color",
            cols: opts.cols,
            rows: opts.rows,
            cwd: opts.cwd,
            env: opts.env,
          });
          sendJson(FRAME_SPAWNED, { pid: proc.pid });

          proc.onData((data: string) => {
            const buf = Buffer.from(data, "utf-8");
            outputBatch.push(buf);
            outputSize += buf.length;
            if (outputSize >= OUTPUT_FLUSH_SIZE) {
              flushOutput();
            } else {
              scheduleFlush();
            }
          });

          proc.onExit(({ exitCode, signal }) => {
            flushOutput();
            sendJson(FRAME_EXIT, { exitCode, signal } satisfies ExitPayload);
            proc = null;
            setTimeout(() => process.exit(0), 200);
          });
        } catch (err) {
          sendJson(FRAME_ERROR, { message: String(err) });
        }
        break;
      }

      case FRAME_WRITE:
        proc?.write(payload.toString("utf-8"));
        break;

      case FRAME_RESIZE: {
        if (!proc) break;
        const r = JSON.parse(payload.toString("utf-8")) as ResizePayload;
        proc.resize(r.cols, r.rows);
        break;
      }

      case FRAME_KILL:
        if (proc) {
          const pid = proc.pid;
          proc.kill();
          setTimeout(() => {
            try {
              process.kill(pid, "SIGKILL");
            } catch {
              /* already exited */
            }
          }, KILL_ESCALATION_MS);
        }
        break;

      case FRAME_DISPOSE:
        if (proc) {
          try {
            proc.kill();
          } catch {
            /* */
          }
        }
        setTimeout(() => process.exit(0), 200);
        break;
    }
  }
});

// Signal ready to parent
sendJson(FRAME_READY, {});

// Parent disconnected — clean up
process.stdin.on("end", () => {
  if (proc) {
    try {
      proc.kill();
    } catch {
      /* */
    }
  }
  process.exit(0);
});

process.on("uncaughtException", (err) => {
  sendJson(FRAME_ERROR, { message: `Uncaught: ${err.message}` });
});
