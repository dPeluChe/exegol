/**
 * T175 — PreToolUse guard: refuse a write to a path another agent holds.
 *
 * Claims were advisory AND unobservable. In a shared working tree git cannot
 * attribute a change to an agent — by the time a file is dirty, "who did it" is
 * gone — so a violation could only ever be noticed by a human reading a broken
 * merge. The one moment where attribution is certain is BEFORE the write, in
 * the tool call itself, which is what this hook intercepts.
 *
 * Identity is the same per-agent token the MCP shim uses: the hook cannot ask on
 * another agent's behalf, and the server derives the agent from the token plus
 * the process tree rather than trusting anything sent here.
 *
 * It FAILS OPEN on every uncertainty — no socket, no token, no answer, an
 * unparseable payload. A guard that blocks when it cannot reach the app would
 * stop an agent working across an app restart, which is far worse than a missed
 * collision. Claims stay cooperative; this makes the cooperation enforceable
 * where the provider lets us.
 */

import { readFileSync } from "node:fs";
import { connect } from "node:net";
import { isAbsolute, join } from "node:path";
import {
  createNdjsonBuffer,
  encodeRequest,
  type JsonRpcResponse,
  MCP_SOCK_PATH,
} from "./exegol-protocol";

/** Claude Code blocks a tool call on exit 2 and feeds stderr back to the model. */
const EXIT_BLOCK = 2;
const ANSWER_TIMEOUT_MS = 2_000;

function allow(): never {
  process.exit(0);
}

function resolveToken(): string {
  const perSession = process.env.EXEGOL_MCP_TOKEN;
  if (perSession) return perSession;
  const fromFile = process.env.EXEGOL_MCP_TOKEN_FILE;
  if (fromFile) return fromFile;
  try {
    const raw = readFileSync(join(process.cwd(), ".mcp.json"), "utf-8");
    const parsed = JSON.parse(raw) as {
      mcpServers?: { exegol?: { env?: Record<string, string> } };
    };
    const env = parsed.mcpServers?.exegol?.env;
    return env?.EXEGOL_MCP_TOKEN_FILE ?? env?.EXEGOL_MCP_TOKEN ?? "";
  } catch {
    return "";
  }
}

/** The file a write-shaped tool call targets, or null when it targets none. */
function targetPath(payload: unknown): string | null {
  const input = (payload as { tool_input?: Record<string, unknown> } | null)?.tool_input;
  const raw = input?.file_path ?? input?.path ?? input?.notebook_path;
  if (typeof raw !== "string" || raw.length === 0) return null;
  return isAbsolute(raw) ? raw : join(process.cwd(), raw);
}

function readStdin(): Promise<string> {
  return new Promise((resolve) => {
    let buf = "";
    process.stdin.setEncoding("utf-8");
    process.stdin.on("data", (chunk) => {
      buf += chunk;
    });
    process.stdin.on("end", () => resolve(buf));
    process.stdin.on("error", () => resolve(""));
  });
}

async function main(): Promise<void> {
  const token = resolveToken();
  if (!token) allow();

  let path: string | null = null;
  try {
    path = targetPath(JSON.parse(await readStdin()));
  } catch {
    allow();
  }
  if (!path) allow();

  const answer = await new Promise<{ allowed: boolean; heldBy?: string; note?: string } | null>(
    (resolve) => {
      const socket = connect(MCP_SOCK_PATH);
      const done = (value: { allowed: boolean; heldBy?: string; note?: string } | null) => {
        socket.destroy();
        resolve(value);
      };
      const timer = setTimeout(() => done(null), ANSWER_TIMEOUT_MS);
      timer.unref?.();
      socket.on("error", () => done(null));
      socket.on(
        "data",
        createNdjsonBuffer<JsonRpcResponse>((res) => {
          clearTimeout(timer);
          done((res.result as { allowed: boolean; heldBy?: string }) ?? null);
        }),
      );
      socket.on("connect", () => {
        socket.write(encodeRequest(1, "check_path", { token, ppid: process.ppid, path }));
      });
    },
  );

  if (!answer || answer.allowed) allow();

  const why = answer.note ? ` Their note: ${answer.note}` : "";
  process.stderr.write(
    `${path} is claimed by agent "${answer.heldBy}" — Exegol refused the write.${why}\n` +
      "Pick a different file, or agree the handover with them via agent_send. " +
      "If they are done, they should call release_paths.\n",
  );
  process.exit(EXIT_BLOCK);
}

void main();
