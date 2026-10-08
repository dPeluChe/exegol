import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { scanPerCwdDir } from "../pool";
import { readHead } from "../read-head";
import { type LocalHistoryProvider, type LocalSession, normalizeTitle } from "../types";

/**
 * gemini files a directory per repo under `tmp/<sha256 of the cwd>` — the
 * directory name is the ONLY link to a path, since nothing inside names it.
 * Verified by hashing this machine's real project paths against what is on
 * disk (19 matched).
 */
function projectDirFor(cwd: string): string {
  return createHash("sha256").update(cwd).digest("hex");
}

/** A parse past this blocks the main thread long enough to be felt. */
const MAX_CHAT_BYTES = 2 * 1024 * 1024;

interface GeminiChat {
  sessionId?: string;
  startTime?: string;
  lastUpdated?: string;
  messages?: Array<{ type?: string; content?: string; timestamp?: string }>;
}

/** `info` is the CLI talking to itself (update notices and the like). */
function firstUserMessage(chat: GeminiChat): string | null {
  const user = (chat.messages ?? []).find(
    (m) => m.type === "user" && (m.content ?? "").trim().length > 2,
  );
  return normalizeTitle(user?.content);
}

export const geminiHistory: LocalHistoryProvider = {
  id: "gemini",

  async list(cwds: string[], since: number): Promise<LocalSession[]> {
    const tmp = join(homedir(), ".gemini", "tmp");
    const slugs = await projectSlugs();
    const [legacy, current] = await Promise.all([
      scanPerCwdDir(cwds, {
        dirFor: (cwd) => join(tmp, projectDirFor(cwd), "chats"),
        ext: ".json",
        read: (path, entry, cwd) => readChat(path, entry, cwd, since),
      }),
      scanPerCwdDir(
        cwds.filter((cwd) => slugs[cwd]),
        {
          dirFor: (cwd) => join(tmp, slugs[cwd] ?? "", "chats"),
          ext: ".jsonl",
          read: (path, entry, cwd) => readJsonlChat(path, entry, cwd, since),
        },
      ),
    ]);
    const chats = [...legacy, ...current];
    // gemini reuses a session id across resumed chats, writing one file per
    // resume. Those are ONE session picked up again, not several — and left
    // separate they collide on the id the timeline keys rows by.
    return collapseResumes(chats);
  },
};

/**
 * gemini 0.4x moved new chats to `tmp/<slug>/chats/*.jsonl`, the slug assigned per path in
 * `projects.json`. Reading only the sha256 layout found no session written since, so "Continue
 * last" dropped `--resume latest` on every folder that had one
 */
async function projectSlugs(): Promise<Record<string, string>> {
  try {
    const raw = await readFile(join(homedir(), ".gemini", "projects.json"), "utf-8");
    const parsed = JSON.parse(raw) as { projects?: Record<string, string> };
    return parsed.projects ?? {};
  } catch {
    return {};
  }
}

interface GeminiJsonlLine {
  sessionId?: string;
  startTime?: string;
  type?: string;
  content?: string | Array<{ text?: string }>;
}

function lineText(content: GeminiJsonlLine["content"]): string | null {
  if (typeof content === "string") return content;
  return content?.find((c) => typeof c.text === "string")?.text ?? null;
}

/** Line 1 is the session header; a chat with no user line yet is one gemini never resumes */
async function readJsonlChat(
  path: string,
  entry: string,
  cwd: string,
  since: number,
): Promise<LocalSession | null> {
  try {
    const { head, sizeBytes, modifiedAt } = await readHead(path);
    if (modifiedAt < since) return null;
    let sessionId = entry.replace(/\.jsonl$/, "");
    let startedAt: number | null = null;
    let title: string | null = null;
    for (const raw of head.split("\n")) {
      if (!raw.startsWith("{")) continue;
      let line: GeminiJsonlLine;
      try {
        line = JSON.parse(raw) as GeminiJsonlLine;
      } catch {
        continue; // the cut tail of the head read
      }
      if (line.sessionId) sessionId = line.sessionId;
      if (line.startTime && startedAt === null) {
        startedAt = Math.floor(Date.parse(line.startTime) / 1000);
      }
      if (line.type === "user") {
        title = normalizeTitle(lineText(line.content)) ?? "";
        break;
      }
    }
    if (title === null) return null;
    return {
      provider: "gemini",
      sessionId,
      title: title || null,
      cwd,
      branch: null,
      startedAt,
      endedAt: modifiedAt,
      version: null,
      sizeBytes,
    };
  } catch {
    return null;
  }
}

function collapseResumes(sessions: LocalSession[]): LocalSession[] {
  const bySession = new Map<string, LocalSession>();

  for (const session of sessions.sort((a, b) => (a.startedAt ?? 0) - (b.startedAt ?? 0))) {
    const existing = bySession.get(session.sessionId);
    if (!existing) {
      bySession.set(session.sessionId, session);
      continue;
    }
    // Sorted by start above, so `existing` IS the first chat — its question is
    // the one that opened the session.
    bySession.set(session.sessionId, {
      ...existing,
      title: existing.title ?? session.title,
      endedAt: Math.max(existing.endedAt ?? 0, session.endedAt ?? 0),
      sizeBytes: existing.sizeBytes + session.sizeBytes,
    });
  }

  return [...bySession.values()];
}

async function readChat(
  path: string,
  entry: string,
  cwd: string,
  since: number,
): Promise<LocalSession | null> {
  try {
    const info = await stat(path);
    // Rejected on the stat, BEFORE reading. A chat file can be tens of
    // megabytes (30 MB measured here) and gemini's whole store for one repo hit
    // 81 MB — all of it read, decoded and parsed only to be dropped by a date
    // filter that the mtime could have answered for free. mtime is never older
    // than lastUpdated, so it is a safe pre-filter.
    if (Math.floor(info.mtimeMs / 1000) < since) return null;
    // Past that size the parse alone blocks the main process for ~60ms, and a
    // title is not worth it — the row still carries its times and its size.
    if (info.size > MAX_CHAT_BYTES) {
      return {
        provider: "gemini",
        sessionId: entry.replace(/\.json$/, ""),
        title: null,
        cwd,
        branch: null,
        startedAt: null,
        endedAt: Math.floor(info.mtimeMs / 1000),
        version: null,
        sizeBytes: info.size,
      };
    }

    const chat = JSON.parse(await readFile(path, "utf-8")) as GeminiChat;
    const endedAt = chat.lastUpdated
      ? Math.floor(Date.parse(chat.lastUpdated) / 1000)
      : Math.floor(info.mtimeMs / 1000);
    if (endedAt < since) return null;

    return {
      provider: "gemini",
      sessionId: chat.sessionId ?? entry.replace(/\.json$/, ""),
      title: firstUserMessage(chat),
      cwd,
      branch: null,
      startedAt: chat.startTime ? Math.floor(Date.parse(chat.startTime) / 1000) : null,
      endedAt,
      version: null,
      sizeBytes: info.size,
    };
  } catch {
    return null;
  }
}
