import { readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ClaudeMcpServerInfo } from "@exegol/shared";

/** The person's own MCP servers as Claude Code would load them in a folder, read from its config
 *  files. Definitions hold secrets (env, headers): only names, scope and transport leave here. */
interface ClaudeServer extends ClaudeMcpServerInfo {
  definition: Record<string, unknown>;
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

function transportOf(def: Record<string, unknown>): ClaudeMcpServerInfo["transport"] {
  return def.type === "http" || def.type === "sse" || def.type === "ws" ? def.type : "stdio";
}

function serversIn(raw: unknown, scope: ClaudeMcpServerInfo["scope"]): ClaudeServer[] {
  if (!isRecord(raw)) return [];
  return Object.entries(raw)
    .filter((e): e is [string, Record<string, unknown>] => isRecord(e[1]) && e[0] !== "exegol")
    .map(([name, definition]) => ({ name, scope, transport: transportOf(definition), definition }));
}

/** Pure. `folders` are tried in order for the local scope and the first with servers wins;
 *  a name set in several scopes keeps Claude Code's order: local, then project, then user */
export function claudeServersFrom(
  userConfig: unknown,
  projectFile: unknown,
  folders: string[],
): ClaudeServer[] {
  const user = isRecord(userConfig) ? userConfig : {};
  const projects = isRecord(user.projects) ? user.projects : {};
  const local = folders
    .map((f) => (isRecord(projects[f]) ? serversIn(projects[f].mcpServers, "local") : []))
    .find((list) => list.length > 0);
  const project = serversIn(isRecord(projectFile) ? projectFile.mcpServers : null, "project");
  const byName = new Map<string, ClaudeServer>();
  for (const s of [...serversIn(user.mcpServers, "user"), ...project, ...(local ?? [])]) {
    byName.set(s.name, s);
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

const cache = new Map<string, { mtimeMs: number; value: unknown }>();

/** The user config runs to megabytes: parsed again only when the file changed */
function readJson(path: string): unknown {
  try {
    const { mtimeMs } = statSync(path);
    const held = cache.get(path);
    if (held?.mtimeMs === mtimeMs) return held.value;
    const value: unknown = JSON.parse(readFileSync(path, "utf-8"));
    cache.set(path, { mtimeMs, value });
    return value;
  } catch {
    return null;
  }
}

function readClaudeServers(folders: string[]): ClaudeServer[] {
  // The repo file of the session's own folder (a worktree has its copy), else the project's
  const repoFile = folders.map((f) => readJson(join(f, ".mcp.json"))).find((v) => v !== null);
  return claudeServersFrom(readJson(join(homedir(), ".claude.json")), repoFile ?? null, folders);
}

/** For the project's settings: what a session there would load, without its definitions */
export function listClaudeServers(projectPath: string): ClaudeMcpServerInfo[] {
  return readClaudeServers([projectPath]).map(({ name, scope, transport }) => ({
    name,
    scope,
    transport,
  }));
}

/** The chosen servers' definitions for a session's own config file; `folders` is its cwd, then
 *  the project root. A name no longer configured is left out */
export function pickClaudeServers(folders: string[], names: string[]): Record<string, unknown> {
  const wanted = new Set(names);
  const out: Record<string, unknown> = {};
  for (const s of readClaudeServers(folders)) {
    if (wanted.has(s.name)) out[s.name] = s.definition;
  }
  return out;
}
