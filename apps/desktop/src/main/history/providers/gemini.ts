import { createHash } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { FILE_CONCURRENCY, mapWithConcurrency } from "../pool";
import type { LocalHistoryProvider, LocalSession } from "../types";

/**
 * gemini files a directory per repo under `tmp/<sha256 of the cwd>` — the
 * directory name is the ONLY link to a path, since nothing inside names it.
 * Verified by hashing this machine's real project paths against what is on
 * disk (19 matched).
 */
function projectDirFor(cwd: string): string {
  return createHash("sha256").update(cwd).digest("hex");
}

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
  return user?.content?.replace(/\s+/g, " ").trim().slice(0, 120) ?? null;
}

export const geminiHistory: LocalHistoryProvider = {
  id: "gemini",

  async list(cwds: string[], since: number): Promise<LocalSession[]> {
    const found = await Promise.all(
      cwds.map(async (cwd) => {
        const dir = join(homedir(), ".gemini", "tmp", projectDirFor(cwd), "chats");
        let entries: string[];
        try {
          entries = await readdir(dir);
        } catch {
          return []; // no gemini history for this directory — normal
        }

        const chats = await mapWithConcurrency(
          entries.filter((e) => e.endsWith(".json")),
          FILE_CONCURRENCY,
          (entry) => readChat(join(dir, entry), entry, cwd, since),
        );
        // gemini reuses a session id across resumed chats, writing one file per
        // resume. Those are ONE session picked up again, not several — and left
        // separate they collide on the id the timeline keys rows by.
        return collapseResumes(chats.filter((c): c is LocalSession => c !== null));
      }),
    );

    return found.flat();
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
    // The first chat holds the question that opened the session.
    existing.title ??= session.title;
    existing.endedAt = Math.max(existing.endedAt ?? 0, session.endedAt ?? 0);
    existing.sizeBytes += session.sizeBytes;
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
    const raw = await readFile(path, "utf-8");
    const chat = JSON.parse(raw) as GeminiChat;

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
