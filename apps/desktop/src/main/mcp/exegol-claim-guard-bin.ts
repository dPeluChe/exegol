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
const GUARD_DEADLINE_MS = 3_000;

function allow(): never {
  process.exit(0);
}

/**
 * Env only — deliberately NOT the shim's `<cwd>/.mcp.json` fallback.
 *
 * That fallback exists for codex, which sanitizes the env it gives MCP servers.
 * This guard runs only under claude-code, which gets a per-agent config outside
 * the repo and always has the token in its PTY env. In a shared repo the cwd
 * file holds a SIBLING's token, so falling back to it would authenticate this
 * guard as another agent — allowing writes to paths that agent holds and
 * blocking the ones this one holds. No token means fail open, which is already
 * the contract.
 */
function resolveToken(): string {
  return process.env.EXEGOL_MCP_TOKEN ?? "";
}

/** The file a write-shaped tool call targets, or null when it targets none. */
export function targetPath(payload: unknown): string | null {
  const hook = payload as { tool_input?: Record<string, unknown>; cwd?: unknown } | null;
  const input = hook?.tool_input;
  const raw =
    input?.file_path ??
    input?.path ??
    input?.notebook_path ??
    (input?.edits as { file_path?: string }[] | undefined)?.[0]?.file_path;
  if (typeof raw !== "string" || raw.length === 0) return null;
  // The payload carries an authoritative cwd; process.cwd() is only incidentally
  // the same one.
  const base = typeof hook?.cwd === "string" && hook.cwd ? hook.cwd : process.cwd();
  return isAbsolute(raw) ? raw : join(base, raw);
}

const STDIN_TIMEOUT_MS = 1_000;

function readStdin(): Promise<string> {
  return new Promise((resolve) => {
    let buf = "";
    // A parent that never closes stdin would otherwise hang until Claude Code's
    // own hook timeout — ten minutes of stall on a single Edit.
    const timer = setTimeout(() => resolve(""), STDIN_TIMEOUT_MS);
    timer.unref?.();
    const done = (value: string) => {
      clearTimeout(timer);
      resolve(value);
    };
    process.stdin.setEncoding("utf-8");
    process.stdin.on("data", (chunk) => {
      buf += chunk;
    });
    process.stdin.on("end", () => done(buf));
    process.stdin.on("error", () => done(""));
  });
}

async function main(): Promise<void> {
  // A guard that fails open on every uncertainty must also fail open on "I
  // hung": without this, a stdin that never ends blocks the tool call until
  // Claude Code's own hook timeout. NOT unref'd — it has to be able to fire.
  setTimeout(allow, GUARD_DEADLINE_MS);

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
        // No ppid on purpose: resolving it costs the MAIN process three
        // synchronous `ps` forks per write, and it buys nothing here — this
        // guard only runs under claude-code, which gets a per-agent token, so
        // the token alone is unambiguous. Ambiguity already fails open.
        socket.write(encodeRequest(1, "check_path", { token, path }));
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

// Guarded so the parsing helpers can be unit-tested without running the hook.
if (require.main === module) void main();
