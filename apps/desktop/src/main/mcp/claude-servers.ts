import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import type { ClaudeMcpServerInfo } from "@exegol/shared";
import { claudeConfigFile, trustKey } from "../agents/claude-trust";
import { logger } from "../lib/logger";
import { type KnownServer, serverHints } from "../system/session-processes";
import { EXEGOL_SERVER_KEY } from "./exegol-mcp-config";

// Definitions hold secrets (env, headers): only names, scope and transport leave this module
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
    .filter(
      (e): e is [string, Record<string, unknown>] => isRecord(e[1]) && e[0] !== EXEGOL_SERVER_KEY,
    )
    .map(([name, definition]) => ({ name, scope, transport: transportOf(definition), definition }));
}

const firstWithServers = (lists: ClaudeServer[][]): ClaudeServer[] =>
  lists.find((list) => list.length > 0) ?? [];

/** Only the parts read here: the config also holds every project's history */
export function mcpSlice(config: unknown): unknown {
  if (!isRecord(config)) return null;
  const projects: Record<string, unknown> = {};
  if (isRecord(config.projects)) {
    for (const [key, value] of Object.entries(config.projects)) {
      if (isRecord(value) && isRecord(value.mcpServers)) {
        projects[key] = { mcpServers: value.mcpServers };
      }
    }
  }
  return { mcpServers: config.mcpServers, projects };
}

/** `repoFiles` are the `.mcp.json` of `folders`, in the same order: the first folder with servers
 *  wins in each scope, and a name set in several keeps Claude Code's order: local, project, user */
export function claudeServersFrom(
  userConfig: unknown,
  repoFiles: unknown[],
  folders: string[],
): ClaudeServer[] {
  const user = isRecord(userConfig) ? userConfig : {};
  const projects = isRecord(user.projects) ? user.projects : {};
  const local = firstWithServers(
    folders.map((f) => {
      const entry = projects[trustKey(f)];
      return isRecord(entry) ? serversIn(entry.mcpServers, "local") : [];
    }),
  );
  const project = firstWithServers(
    repoFiles.map((file) => serversIn(isRecord(file) ? file.mcpServers : null, "project")),
  );
  const byName = new Map<string, ClaudeServer>();
  for (const s of [...serversIn(user.mcpServers, "user"), ...project, ...local]) {
    byName.set(s.name, s);
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

const cache = new Map<string, { mtimeMs: number; value: unknown }>();

// Claude Code's config runs to megabytes and is rewritten often: parsed only when it changed
async function readJson(path: string, keep: (v: unknown) => unknown = (v) => v): Promise<unknown> {
  try {
    const { mtimeMs } = await stat(path);
    const held = cache.get(path);
    if (held?.mtimeMs === mtimeMs) return held.value;
    const value = keep(JSON.parse(await readFile(path, "utf-8")));
    cache.set(path, { mtimeMs, value });
    return value;
  } catch {
    return null;
  }
}

async function readClaudeServers(folders: string[]): Promise<ClaudeServer[]> {
  const [user, ...repoFiles] = await Promise.all([
    readJson(claudeConfigFile(), mcpSlice),
    ...folders.map((f) => readJson(join(f, ".mcp.json"))),
  ]);
  return claudeServersFrom(user, repoFiles, folders);
}

export async function listClaudeServers(projectPath: string): Promise<ClaudeMcpServerInfo[]> {
  const servers = await readClaudeServers([projectPath]);
  return servers.map(({ name, scope, transport }) => ({ name, scope, transport }));
}

/** What tells each local server's processes apart in the process table; stays in main */
export async function knownClaudeServers(projectPath: string): Promise<KnownServer[]> {
  const servers = await readClaudeServers([projectPath]);
  return servers.flatMap(({ name, definition: { command, args } }) =>
    typeof command === "string"
      ? [{ name, hints: serverHints(command, Array.isArray(args) ? args.map(String) : []) }]
      : [],
  );
}

/** The definitions a Claude session of a project with a chosen list loads besides Exegol; null
 *  when the project has no list. `folders`: the session's cwd, then the project root */
export async function chosenClaudeServers(
  agentId: string,
  chosen: string[] | null | undefined,
  folders: string[],
): Promise<Record<string, unknown> | null> {
  if (!chosen) return null;
  const wanted = new Set(chosen);
  const out: Record<string, unknown> = {};
  for (const s of await readClaudeServers(folders)) {
    if (wanted.has(s.name)) out[s.name] = s.definition;
  }
  logger.info(
    `[ExegolMcp] ${agentId} strict: ${Object.keys(out).length} of ${chosen.length} chosen server(s) found`,
  );
  return out;
}
