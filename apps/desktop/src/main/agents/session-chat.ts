import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import type { Agent, ChatPage, OlderChatPage } from "@exegol/shared";
import type Database from "libsql";
import { getAgent, getAgentCwd, listLiveProjectSessions } from "../db/queries/agents";
import { claudeProjectDir, claudeRoot } from "../history/providers/claude-code";
import { codexRoot, dayDirs } from "../history/providers/codex";
import { broadcast } from "../lib/event-bus";
import { setBounded } from "../lib/set-bounded";
import { assertSafePath } from "../security/path-guard";
import { getPtyHost } from "../terminal/pty-host";
import { agyTurns } from "./agy-terminal";
import { devinDbPath, devinPage, olderDevinPage } from "./devin-chat";
import { hookCwdOf, hookSessionOf } from "./hook-cwd";
import { olderOpencodePage, opencodeDbPath, opencodePage } from "./opencode-chat";
import { providerSessionId, SESSION_ID_RE } from "./provider-session-id";
import {
  type LineParser,
  parseClaudeLine,
  parseCodexLine,
  readOlder,
  readTranscript,
  terminalTurns,
} from "./session-transcript";

const CODEX_LOOKBACK_SEC = 180 * 86400;
const NOT_FOUND_RETRY_MS = 30_000;
const PUSH_DELAY_MS = 500;
const MAX_TRACKED = 256;

async function exists(path: string): Promise<boolean> {
  return stat(path).then(
    () => true,
    () => false,
  );
}

async function findClaudeFile(sessionId: string, cwds: (string | null)[]): Promise<string | null> {
  const root = claudeRoot();
  for (const cwd of cwds) {
    const path = cwd && join(root, claudeProjectDir(cwd), `${sessionId}.jsonl`);
    if (path && (await exists(path))) return path;
  }
  // The session moved folders: the file stays where it began
  const dirs = await readdir(root).catch(() => [] as string[]);
  for (const dir of dirs) {
    const path = join(root, dir, `${sessionId}.jsonl`);
    if (await exists(path)) return path;
  }
  return null;
}

async function findCodexFile(sessionId: string): Promise<string | null> {
  const since = Math.floor(Date.now() / 1000) - CODEX_LOOKBACK_SEC;
  const suffix = `-${sessionId}.jsonl`;
  for (const dir of (await dayDirs(codexRoot(), since)).reverse()) {
    const names = await readdir(dir).catch(() => [] as string[]);
    const name = names.find((n) => n.endsWith(suffix));
    if (name) return join(dir, name);
  }
  return null;
}

interface Provider {
  parse: LineParser;
  root: () => string;
  find: (sessionId: string, cwds: (string | null)[]) => Promise<string | null>;
}

/** The CLIs that keep a transcript Exegol can read */
const PROVIDERS: Record<string, Provider> = {
  "claude-code": { parse: parseClaudeLine, root: claudeRoot, find: findClaudeFile },
  codex: { parse: parseCodexLine, root: codexRoot, find: findCodexFile },
};

interface Located {
  key: string;
  path: string | null;
  at: number;
}

const located = new Map<string, Located>();

/** The id the CLI's own store files this session under, safe to name a file with */
function sessionIdOf(agent: Agent): string | null {
  const id =
    providerSessionId(agent.cliType, agent.claudeSessionId ?? null, agent.resumeCommand ?? null) ??
    hookSessionOf(agent.id);
  return id && SESSION_ID_RE.test(id) ? id : null;
}

/** Found under the CLI's own store, links resolved: the file is never named by the renderer */
async function transcriptPath(
  db: Database.Database,
  agent: Agent,
  provider: Provider,
): Promise<string | null> {
  const sessionId = sessionIdOf(agent);
  if (!sessionId) return null;

  const key = `${agent.cliType}:${sessionId}`;
  const known = located.get(agent.id);
  const fresh = known?.key === key && (known.path || Date.now() - known.at < NOT_FOUND_RETRY_MS);
  if (fresh) return known.path;

  const found = await provider.find(sessionId, [hookCwdOf(agent.id), getAgentCwd(db, agent.id)]);
  const path = found
    ? await assertSafePath(found, { allowedBases: [provider.root()] }).catch(() => null)
    : null;
  setBounded(located, agent.id, { key, path, at: Date.now() }, MAX_TRACKED);
  return path;
}

const pushTimers = new Map<string, NodeJS.Timeout>();

/** A turn began or ended: cut the terminal text there, and tell an open chat */
export function noteChatBoundary(agentId: string, cliType: string): void {
  if (!PROVIDERS[cliType]) getPtyHost().markTurn(agentId);
  if (pushTimers.has(agentId)) return;
  const timer = setTimeout(() => {
    pushTimers.delete(agentId);
    broadcast("agent:chat-updated", { agentId });
  }, PUSH_DELAY_MS);
  timer.unref?.();
  pushTimers.set(agentId, timer);
}

/** The folders to look in. A store found by folder cannot tell two live sessions of one CLI in the
 *  same folder apart: either could be the other's, so those stay on terminal text */
function loneFolders(db: Database.Database, agent: Agent): string[] {
  const own = getAgentCwd(db, agent.id);
  const shared = listLiveProjectSessions(db, agent.projectId).some(
    (s) => s.id !== agent.id && s.cliType === agent.cliType && s.cwd === own,
  );
  if (shared) return [];
  return [...new Set([hookCwdOf(agent.id), own])].filter((cwd): cwd is string => !!cwd);
}

type StorePage = Omit<ChatPage, "fromTerminal" | "markdown">;

interface ChatStore {
  page: (db: Database.Database, agent: Agent, cursor: string | undefined) => StorePage | null;
  older: (before: string) => OlderChatPage;
}

/** The CLIs that keep their turns in a database of their own */
const STORES: Record<string, ChatStore> = {
  opencode: {
    page(db, agent, cursor) {
      const cwds = loneFolders(db, agent);
      if (cwds.length === 0) return null;
      return opencodePage(opencodeDbPath(), cwds, (agent.startedAt ?? 0) * 1000, cursor);
    },
    older: (before) => olderOpencodePage(opencodeDbPath(), before),
  },
  devin: {
    page(db, agent, cursor) {
      const target = {
        id: sessionIdOf(agent),
        cwds: loneFolders(db, agent),
        sinceSec: agent.startedAt ?? 0,
      };
      return devinPage(devinDbPath(), target, cursor);
    },
    older: (before) => olderDevinPage(devinDbPath(), before),
  },
};

const NOTHING: ChatPage = {
  turns: [],
  cursor: null,
  reset: true,
  fromTerminal: false,
  markdown: false,
  older: null,
};

/** A CLI's own record of the turns holds what the model wrote, Markdown as it was */
const RECORDED = { fromTerminal: false, markdown: true };

/** Tailed by byte offset from `cursor`; a CLI with no transcript sends its terminal text whole */
export async function chatTurns(
  db: Database.Database,
  agentId: string,
  cursor: string | undefined,
): Promise<ChatPage> {
  const agent = getAgent(db, agentId);
  if (!agent) return NOTHING;

  const stored = STORES[agent.cliType]?.page(db, agent, cursor);
  if (stored) return { ...stored, ...RECORDED };

  const provider = PROVIDERS[agent.cliType];
  const path = provider ? await transcriptPath(db, agent, provider) : null;
  if (provider && path) {
    const page = await readTranscript(path, provider.parse, cursor).catch(() => null);
    return page ? { ...page, ...RECORDED } : NOTHING;
  }
  const text = getPtyHost().textLines(agentId);
  if (!text) return NOTHING;
  const first = text.total - text.lines.length;
  const parsed = agent.cliType === "agy" && !text.altScreen ? agyTurns(text.lines, first) : null;
  // Antigravity's screen shows the raw Markdown; any other terminal text stays as printed
  return {
    turns: parsed ?? terminalTurns(text.lines, first, text.turnLines, text.altScreen),
    cursor: null,
    reset: true,
    fromTerminal: true,
    markdown: parsed !== null,
    older: null,
  };
}

/** What came before a page, walking the transcript back from the `older` it gave */
export async function olderChatTurns(
  db: Database.Database,
  agentId: string,
  before: string,
): Promise<OlderChatPage> {
  const nothing = { turns: [], older: null };
  const agent = getAgent(db, agentId);
  const store = agent && STORES[agent.cliType];
  if (store) return store.older(before);
  const provider = agent && PROVIDERS[agent.cliType];
  const path = agent && provider ? await transcriptPath(db, agent, provider) : null;
  if (!provider || !path) return nothing;
  return readOlder(path, provider.parse, before).catch(() => nothing);
}
