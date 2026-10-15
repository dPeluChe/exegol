/**
 * The per-DIRECTORY MCP token lives in `~/.exegol/mcp/tokens/<key>`, never in the
 * project config: those files sit in the user's repo and one was committed (2026-10-15).
 * The project config carries only the path. Node builtins only: the shim bundles this.
 */

import { createHash } from "node:crypto";
import {
  chmodSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";

export const MCP_TOKENS_DIR = join(homedir(), ".exegol", "mcp", "tokens");

/** Config env key holding the token FILE path */
export const TOKEN_PATH_ENV = "EXEGOL_MCP_TOKEN_PATH";
/** Older builds put the raw token inline under this (misleading) name; still read */
export const LEGACY_INLINE_TOKEN_ENV = "EXEGOL_MCP_TOKEN_FILE";
export const SESSION_TOKEN_ENV = "EXEGOL_MCP_TOKEN";

const MAX_TOKEN_BYTES = 512;

/** Same folder through a symlink or a trailing slash = same key */
export function tokenKeyFor(cwd: string): string {
  let real = resolve(cwd);
  try {
    real = realpathSync(cwd);
  } catch {
    /* gone or unreadable: the resolved path still names it */
  }
  return createHash("sha256").update(real).digest("hex").slice(0, 32);
}

export function tokenFilePathFor(cwd: string, dir = MCP_TOKENS_DIR): string {
  return join(dir, tokenKeyFor(cwd));
}

/** Temp file + rename: an existing symlink at the target is replaced, never followed */
export function writeTokenFile(cwd: string, token: string, dir = MCP_TOKENS_DIR): string {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  chmodSync(dir, 0o700);
  const path = tokenFilePathFor(cwd, dir);
  const tmp = `${path}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tmp, token, { encoding: "utf-8", mode: 0o600, flag: "wx" });
  try {
    renameSync(tmp, path);
  } catch (err) {
    unlinkSync(tmp);
    throw err;
  }
  return path;
}

export function removeTokenFile(cwd: string, dir = MCP_TOKENS_DIR): void {
  try {
    unlinkSync(tokenFilePathFor(cwd, dir));
  } catch {
    /* already gone */
  }
}

/** The token at `path`, only for a regular file directly inside `dir`; a config is
 *  repo content, so a path it names elsewhere is refused */
export function readTokenFile(path: string, dir = MCP_TOKENS_DIR): string | null {
  if (!isAbsolute(path) || dirname(resolve(path)) !== resolve(dir)) return null;
  try {
    const info = lstatSync(path);
    if (!info.isFile() || info.size > MAX_TOKEN_BYTES) return null;
    const token = readFileSync(path, "utf-8").trim();
    return token.length > 0 ? token : null;
  } catch {
    return null;
  }
}

/** Token from a config file's env block: the path first, then the legacy inline keys */
export function tokenFromEnvBlock(
  env: Record<string, unknown> | undefined,
  dir = MCP_TOKENS_DIR,
): string | null {
  const path = env?.[TOKEN_PATH_ENV];
  if (typeof path === "string" && path.length > 0) {
    const token = readTokenFile(path, dir);
    if (token) return token;
  }
  for (const key of [LEGACY_INLINE_TOKEN_ENV, SESSION_TOKEN_ENV]) {
    const value = env?.[key];
    if (typeof value === "string" && value.length > 0) return value;
  }
  return null;
}

/**
 * The shim's identity. The per-SESSION env token first (the CLI inherits it from the
 * PTY); the directory's token, shared by every session there, only after it; the cwd
 * `.mcp.json` last, for CLIs that sanitize the env they give MCP servers (codex).
 */
export function resolveShimToken(
  env: Record<string, string | undefined>,
  cwd: string,
  dir = MCP_TOKENS_DIR,
): string {
  const perSession = env[SESSION_TOKEN_ENV];
  if (perSession) return perSession;
  const fromPath = env[TOKEN_PATH_ENV] ? readTokenFile(env[TOKEN_PATH_ENV], dir) : null;
  if (fromPath) return fromPath;
  const legacy = env[LEGACY_INLINE_TOKEN_ENV];
  if (legacy) return legacy;
  try {
    const parsed = JSON.parse(readFileSync(join(cwd, ".mcp.json"), "utf-8")) as {
      mcpServers?: { exegol?: { env?: Record<string, unknown> } };
    };
    return tokenFromEnvBlock(parsed.mcpServers?.exegol?.env, dir) ?? "";
  } catch {
    return "";
  }
}

/** The line `.git/info/exclude` needs for `relPath` under `prefix` (cwd relative to the
 *  work tree root, as `git rev-parse --show-prefix` prints it), or null when present */
export function excludeLineFor(existing: string, prefix: string, relPath: string): string | null {
  const line = `/${`${prefix}${relPath}`.replace(/[\\*?[]/g, "\\$&")}`;
  return existing.split(/\r?\n/).some((l) => l.trim() === line) ? null : line;
}
