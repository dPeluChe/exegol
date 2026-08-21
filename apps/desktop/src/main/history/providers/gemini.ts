import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { scanPerCwdDir } from "../pool";
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
    const chats = await scanPerCwdDir(cwds, {
      dirFor: (cwd) => join(homedir(), ".gemini", "tmp", projectDirFor(cwd), "chats"),
      ext: ".json",
      read: (path, entry, cwd) => readChat(path, entry, cwd, since),
    });
    // gemini reuses a session id across resumed chats, writing one file per
    // resume. Those are ONE session picked up again, not several — and left
    // separate they collide on the id the timeline keys rows by.
    return collapseResumes(chats);
  },
};

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
