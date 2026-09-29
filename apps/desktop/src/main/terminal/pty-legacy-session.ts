import { spawn as cpSpawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { logger } from "../lib/logger";
import { parseJson } from "../lib/parse-json";
import { HeadlessEmulator } from "./headless-emulator";
import {
  encodeJson,
  FRAME_DATA,
  FRAME_ERROR,
  FRAME_EXIT,
  FRAME_READY,
  FRAME_SPAWN,
  FRAME_SPAWNED,
  FrameDecoder,
  type SpawnPayload,
} from "./pty-ipc";
import { flushScrollbackSync, scheduleScrollbackFlush } from "./pty-scrollback";
import {
  type Session,
  type SessionCallbacks,
  SHELL_READY_TIMEOUT_MS,
  SUBPROCESS_READY_TIMEOUT_MS,
} from "./pty-session-types";
import { scanForMarker } from "./pty-shell-ready";

const SPAWNED_FRAME = z.object({ pid: z.number() });
const EXIT_FRAME = z.object({ exitCode: z.number(), signal: z.number().optional() });
const ERROR_FRAME = z.object({ message: z.string() });

function resolveSubprocessPath(): string {
  const primary = join(__dirname, "pty-subprocess.js");
  if (existsSync(primary)) return primary;
  const nested = join(__dirname, "terminal", "pty-subprocess.js");
  if (existsSync(nested)) return nested;
  logger.warn(`[PtyHost] Subprocess not found at ${primary} or ${nested}, spawn will likely fail`);
  return primary;
}

export interface LegacyHostDeps {
  sessions: Map<string, Session>;
  resolveShellReady(session: Session, state: "ready" | "timed_out"): void;
  cleanup(id: string): void;
}

export function doCreateLegacy(
  host: LegacyHostDeps,
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
      mode: "legacy",
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
    host.sessions.set(id, session);

    if (session.shellReadyState === "pending") {
      session.shellReadyTimeout = setTimeout(() => {
        host.resolveShellReady(session, "timed_out");
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
            const spawned = parseJson(payload.toString(), SPAWNED_FRAME);
            if (!spawned) {
              if (!resolved) {
                resolved = true;
                host.cleanup(id);
                reject(new Error("PTY subprocess sent a malformed spawned frame"));
              }
              break;
            }
            session.pid = spawned.pid;
            resolved = true;
            resolve({ pid: spawned.pid });
            break;
          }

          case FRAME_DATA: {
            let data = payload.toString("utf-8");

            if (session.shellReadyState === "pending") {
              const scan = scanForMarker(data, session);
              data = scan.processedData;
              if (scan.markerFound) {
                host.resolveShellReady(session, "ready");
              }
            }

            if (data.length > 0) {
              emulator.write(data);
              scheduleScrollbackFlush(session);
              callbacks.onData(data);
            }
            break;
          }

          case FRAME_EXIT: {
            // A garbled exit frame still means the process is gone
            const { exitCode, signal } = parseJson(payload.toString(), EXIT_FRAME) ?? {
              exitCode: 1,
            };
            session.alive = false;
            flushScrollbackSync(session);
            host.cleanup(id);
            callbacks.onExit(exitCode, signal);
            break;
          }

          case FRAME_ERROR: {
            const message =
              parseJson(payload.toString(), ERROR_FRAME)?.message ?? "PTY subprocess error";
            callbacks.onError(message);
            if (!resolved) {
              resolved = true;
              host.cleanup(id);
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
        flushScrollbackSync(session);
        host.cleanup(id);
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
        host.cleanup(id);
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
        try {
          child.kill("SIGKILL");
        } catch {
          /* */
        }
        host.cleanup(id);
        reject(new Error("PTY subprocess did not become ready within 10s"));
      }
    }, SUBPROCESS_READY_TIMEOUT_MS);
  });
}
