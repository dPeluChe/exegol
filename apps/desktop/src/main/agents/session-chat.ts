import { open, readdir, realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ChatPage, ChatPeerMessage } from "@exegol/shared";
import type Database from "libsql";
import { getAgent, getAgentCwd } from "../db/queries/agents";
import { listMessages } from "../db/queries/messages";
import { claudeProjectDir } from "../history/providers/claude-code";
import { dayDirs } from "../history/providers/codex";
import { broadcast } from "../lib/event-bus";
import { isInside } from "../system/ports";
import { getPtyHost } from "../terminal/pty-host";
import { hookCwdOf, hookSessionOf } from "./hook-cwd";
import { providerSessionId } from "./provider-session-id";
import {
  type LineParser,
  parseChunk,
  parseClaudeLine,
  parseCodexLine,
  planRead,
  terminalTurns,
} from "./session-transcript";

const SESSION_ID = /^[A-Za-z0-9-]{8,64}$/;
const CODEX_LOOKBACK_SEC = 180 * 86400;
const NOT_FOUND_RETRY_MS = 30_000;
const PEER_MESSAGES = 30;
const PUSH_DELAY_MS = 500;
const MAX_MARKS = 50;
const MAX_TRACKED = 256;

const PARSERS: Record<string, LineParser> = {
  "claude-code": parseClaudeLine,
  codex: parseCodexLine,
};

const claudeRoot = () => join(homedir(), ".claude", "projects");
const codexRoot = () => join(homedir(), ".codex", "sessions");

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

/** Under the CLI's own store, links resolved: the file is never named by the renderer */
async function confined(path: string | null, root: string): Promise<string | null> {
  if (!path) return null;
  const [real, realRoot] = await Promise.all([realpath(path), realpath(root)]).catch(() => [
    null,
    null,
  ]);
  return real && realRoot && isInside(real, realRoot) ? real : null;
}

interface Located {
  key: string;
  path: string | null;
  at: number;
}

const located = new Map<string, Located>();

async function transcriptPath(
  db: Database.Database,
  agentId: string,
  cliType: string,
): Promise<string | null> {
  const row = db
    .prepare("SELECT claude_session_id, resume_command FROM agents WHERE id = ?")
    .get(agentId) as { claude_session_id: string | null; resume_command: string | null };
  const sessionId =
    providerSessionId(cliType, row.claude_session_id, row.resume_command) ?? hookSessionOf(agentId);
  if (!sessionId || !SESSION_ID.test(sessionId)) return null;

  const key = `${cliType}:${sessionId}`;
  const known = located.get(agentId);
  const fresh = known?.key === key && (known.path || Date.now() - known.at < NOT_FOUND_RETRY_MS);
  if (fresh) return known.path;

  const path =
    cliType === "claude-code"
      ? await confined(
          await findClaudeFile(sessionId, [hookCwdOf(agentId), getAgentCwd(db, agentId)]),
          claudeRoot(),
        )
      : await confined(await findCodexFile(sessionId), codexRoot());
  located.set(agentId, { key, path, at: Date.now() });
  if (located.size > MAX_TRACKED) located.delete(located.keys().next().value as string);
  return path;
}

async function readTranscript(path: string, parse: LineParser, cursor: string | undefined) {
  const handle = await open(path, "r");
  try {
    const file = await handle.stat();
    const plan = planRead(cursor, file);
    const chunk = Buffer.alloc(plan.length);
    const { bytesRead } = await handle.read(chunk, 0, plan.length, plan.offset);
    const { turns, nextOffset } = parseChunk(chunk.subarray(0, bytesRead), plan, parse);
    return { turns, cursor: `${file.ino}:${nextOffset}`, reset: plan.reset };
  } finally {
    await handle.close();
  }
}

const turnMarks = new Map<string, number[]>();
const pushTimers = new Map<string, NodeJS.Timeout>();

/** A turn began or ended: cut the terminal text there, and tell an open chat */
export function noteChatBoundary(agentId: string): void {
  const line = getPtyHost().textLines(agentId)?.total;
  if (line !== undefined) {
    const marks = turnMarks.get(agentId) ?? [];
    turnMarks.set(agentId, [...marks, line].slice(-MAX_MARKS));
    if (turnMarks.size > MAX_TRACKED) turnMarks.delete(turnMarks.keys().next().value as string);
  }
  if (pushTimers.has(agentId)) return;
  const timer = setTimeout(() => {
    pushTimers.delete(agentId);
    broadcast("agent:chat-updated", { agentId });
  }, PUSH_DELAY_MS);
  timer.unref?.();
  pushTimers.set(agentId, timer);
}

function peerMessages(db: Database.Database, agentId: string): ChatPeerMessage[] {
  const nameOf = (id: string | null) => {
    const peer = id ? getAgent(db, id) : null;
    return peer?.alias ?? peer?.cliType ?? "Exegol";
  };
  return listMessages(db, { agentId }, PEER_MESSAGES)
    .reverse()
    .map((m) => {
      const incoming = m.toAgentId === agentId;
      return {
        id: m.id,
        incoming,
        peer: nameOf(incoming ? m.fromAgentId : m.toAgentId),
        text: m.content,
        at: m.createdAt,
        delivery: m.deliveryState,
      };
    });
}

/** Tailed by byte offset from `cursor`; a CLI with no transcript sends its terminal text whole */
export async function chatTurns(
  db: Database.Database,
  agentId: string,
  cursor: string | undefined,
): Promise<ChatPage> {
  const agent = getAgent(db, agentId);
  const peers = agent ? peerMessages(db, agentId) : [];
  const none: ChatPage = { turns: [], cursor: null, reset: true, source: "none", peers };
  if (!agent || agent.cliType === "shell") return none;

  const parse = PARSERS[agent.cliType];
  const path = parse ? await transcriptPath(db, agentId, agent.cliType) : null;
  if (parse && path) {
    const page = await readTranscript(path, parse, cursor).catch(() => null);
    return page ? { ...page, source: "transcript", peers } : none;
  }
  const text = getPtyHost().textLines(agentId);
  if (!text) return none;
  const turns = terminalTurns(
    text.lines,
    text.total - text.lines.length,
    turnMarks.get(agentId) ?? [],
    text.altScreen,
  );
  return { turns, cursor: null, reset: true, source: "terminal", peers };
}
