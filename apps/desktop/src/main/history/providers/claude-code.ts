import { readdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { FILE_CONCURRENCY, mapWithConcurrency } from "../pool";
import { readHead } from "../read-head";
import type { LocalHistoryProvider, LocalSession } from "../types";

/**
 * Claude Code names a project directory after its cwd, replacing BOTH `/` and
 * `_` with `-` (so `/a/_code_/repo` becomes `-a--code--repo`). Dots survive.
 *
 * The encoding is lossy — `_code_` and `-code-` land on the same directory — so
 * the transcript's own `cwd` field is what actually decides the match; this only
 * tells us where to look.
 */
function projectDirFor(cwd: string): string {
  return cwd.replace(/[/_]/g, "-");
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
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    const text = content.find(
      (c): c is { type: string; text: string } =>
        typeof c === "object" && c !== null && (c as { type?: string }).type === "text",
    );
    return text?.text ?? null;
  }
  return null;
}

/**
 * Transcripts are append-only JSONL and can reach tens of megabytes, so only the
 * head is read: the title, cwd, branch and start timestamp all appear in the
 * first few lines, and the file's mtime is a better end time than parsing to
 * the last line would be.
 */
export const claudeCodeHistory: LocalHistoryProvider = {
  id: "claude-code",

  async list(cwds: string[], since: number): Promise<LocalSession[]> {
    const found = await Promise.all(
      cwds.map(async (cwd) => {
        const dir = join(homedir(), ".claude", "projects", projectDirFor(cwd));
        let entries: string[];
        try {
          entries = await readdir(dir);
        } catch {
          return []; // no history for this directory — normal
        }

        const transcripts = entries.filter((e) => e.endsWith(".jsonl"));
        const sessions = await mapWithConcurrency(transcripts, FILE_CONCURRENCY, (entry) =>
          readTranscript(join(dir, entry), entry, cwd, since),
        );
        return sessions.filter((s): s is LocalSession => s !== null);
      }),
    );

    return found.flat();
  },
};

async function readTranscript(
  path: string,
  entry: string,
  cwd: string,
  since: number,
): Promise<LocalSession | null> {
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

    for (const raw of head.split("\n")) {
      if (!raw.trim()) continue;
      let line: HeadLine;
      try {
        line = JSON.parse(raw) as HeadLine;
      } catch {
        continue; // a truncated final line is expected — we read a prefix
      }
      if (line.cwd && !recordedCwd) recordedCwd = line.cwd;
      if (line.aiTitle) session.title = line.aiTitle;
      if (line.gitBranch && !session.branch) session.branch = line.gitBranch;
      if (line.version && !session.version) session.version = line.version;
      if (line.timestamp && session.startedAt === null) {
        session.startedAt = Math.floor(Date.parse(line.timestamp) / 1000);
      }
      if (!session.title && line.type === "user") {
        const prompt = firstPromptText(line);
        if (prompt) session.title = prompt.slice(0, 120);
      }
    }

    // The slug is ambiguous; the transcript is not. A session naming a different
    // cwd belongs to a repo that merely slugs the same way.
    return recordedCwd && recordedCwd !== cwd ? null : session;
  } catch {
    return null; // unreadable transcript — skip rather than fail the listing
  }
}
