import { homedir } from "node:os";
import { join } from "node:path";
import { samePath, stripPasteTags } from "@exegol/shared";
import { scanPerCwdDir } from "../pool";
import { readHead, readTail } from "../read-head";
import { type LocalHistoryProvider, type LocalSession, normalizeTitle } from "../types";

/**
 * Claude Code names a project directory after its cwd, every character but a letter or digit
 * becoming `-` (`/a/_code_/.x` is `-a--code---x`, `C:\\a` `C--a`).
 *
 * The encoding is lossy — `_code_` and `-code-` land on the same directory — so
 * the transcript's own `cwd` field is what actually decides the match; this only
 * tells us where to look.
 */
export function claudeProjectDir(cwd: string): string {
  return cwd.replace(/[^a-zA-Z0-9]/g, "-");
}

interface HeadLine {
  type?: string;
  cwd?: string;
  gitBranch?: string;
  timestamp?: string;
  version?: string;
  aiTitle?: string;
  message?: { content?: unknown };
}

/** First user prompt, when the session never earned an AI title. */
function firstPromptText(line: HeadLine): string | null {
  const content = line.message?.content;
  if (typeof content === "string") return stripPasteTags(content);
  if (Array.isArray(content)) {
    const text = content.find(
      (c): c is { type: string; text: string } =>
        typeof c === "object" && c !== null && (c as { type?: string }).type === "text",
    );
    return text ? stripPasteTags(text.text) : null;
  }
  return null;
}

/**
 * Transcripts are append-only JSONL and can reach tens of megabytes, so only the
 * head is read: the title, cwd, branch and start timestamp all appear in the
 * first few lines, and the file's mtime is a better end time than parsing to
 * the last line would be.
 */
const TITLE_TAIL_BYTES = 32 * 1024;
// Claude Code writes the name again every few records; one large record pushes it past 32 KB
const RENAME_TAIL_BYTES = 256 * 1024;
const CUSTOM_TITLE = /"type":"custom-title","customTitle":"((?:[^"\\]|\\.)*)"/g;

export const claudeCodeHistory: LocalHistoryProvider = {
  id: "claude-code",

  list(cwds: string[], since: number): Promise<LocalSession[]> {
    return scanPerCwdDir(cwds, {
      dirFor: projectDirFor,
      ext: ".jsonl",
      read: async (path, entry, cwd) =>
        (await parseTranscript(path, entry, cwd, since))?.session ?? null,
    });
  },
};

export const claudeRoot = () => join(homedir(), ".claude", "projects");

function projectDirFor(cwd: string): string {
  return join(claudeRoot(), claudeProjectDir(cwd));
}

/** The /rename name, else the AI title, of one known session: one file, never the first prompt
 *  (the launcher already shows that as the task) */
export async function claudeSessionName(cwd: string, sessionId: string): Promise<string | null> {
  if (!/^[\w-]{1,100}$/.test(sessionId)) return null;
  const entry = `${sessionId}.jsonl`;
  const parsed = await parseTranscript(join(projectDirFor(cwd), entry), entry, cwd, 0);
  return parsed ? (parsed.session.name ?? parsed.aiTitle) : null;
}

/** The last /rename name in a transcript's tail (Claude writes it again as the file grows) */
export async function claudeRenamedTo(path: string): Promise<string | null> {
  return lastCustomTitle(await readTail(path, undefined, RENAME_TAIL_BYTES));
}

function lastCustomTitle(text: string): string | null {
  const renamed = [...text.matchAll(CUSTOM_TITLE)].pop()?.[1];
  if (!renamed) return null;
  try {
    return normalizeTitle(JSON.parse(`"${renamed}"`) as string);
  } catch {
    return null;
  }
}

async function parseTranscript(
  path: string,
  entry: string,
  cwd: string,
  since: number,
): Promise<{ session: LocalSession; aiTitle: string | null } | null> {
  try {
    const { head, sizeBytes, modifiedAt } = await readHead(path);
    if (modifiedAt < since) return null;

    const session: LocalSession = {
      provider: "claude-code",
      sessionId: entry.replace(/\.jsonl$/, ""),
      title: null,
      cwd,
      branch: null,
      startedAt: null,
      endedAt: modifiedAt,
      version: null,
      sizeBytes,
    };
    let recordedCwd: string | null = null;
    let aiTitle: string | null = null;

    for (const raw of head.split("\n")) {
      if (!raw.trim()) continue;
      let line: HeadLine;
      try {
        line = JSON.parse(raw) as HeadLine;
      } catch {
        continue; // a truncated final line is expected — we read a prefix
      }
      if (line.cwd && !recordedCwd) recordedCwd = line.cwd;
      if (line.aiTitle) {
        aiTitle = normalizeTitle(line.aiTitle);
        session.title = aiTitle;
      }
      if (line.gitBranch && !session.branch) session.branch = line.gitBranch;
      if (line.version && !session.version) session.version = line.version;
      if (line.timestamp && session.startedAt === null) {
        session.startedAt = Math.floor(Date.parse(line.timestamp) / 1000);
      }
      if (!session.title && line.type === "user") {
        const prompt = firstPromptText(line);
        if (prompt) session.title = normalizeTitle(prompt);
      }
    }

    // `/rename` re-appends a custom-title line through the whole transcript: the tail has the latest
    const tail = sizeBytes > head.length ? await readTail(path, sizeBytes, TITLE_TAIL_BYTES) : head;
    // A cut escape at the chunk edge reads as no name: the AI title stays
    const renamed = lastCustomTitle(tail);
    if (renamed) {
      session.name = renamed;
      session.title = renamed;
    }

    // The slug is ambiguous; the transcript is not. A session naming a different
    // cwd belongs to a repo that merely slugs the same way.
    return recordedCwd && !samePath(recordedCwd, cwd) ? null : { session, aiTitle };
  } catch {
    return null; // unreadable transcript — skip rather than fail the listing
  }
}
