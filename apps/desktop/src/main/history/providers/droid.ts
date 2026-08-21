import { readdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { FILE_CONCURRENCY, mapWithConcurrency } from "../pool";
import { readHead } from "../read-head";
import type { LocalHistoryProvider, LocalSession } from "../types";

/**
 * Factory names a session directory after its cwd — but unlike Claude Code it
 * replaces ONLY `/`, leaving underscores intact (`…-dPeluChe-_code_-labs_irma`).
 * Two CLIs, two slug rules; assuming they matched found nothing at all.
 */
function projectDirFor(cwd: string): string {
  return cwd.replace(/\//g, "-");
}

interface StartLine {
  type?: string;
  id?: string;
  title?: string;
}

interface MessageLine {
  type?: string;
  timestamp?: string;
}

/**
 * droid (Factory) writes one JSONL per session under `~/.factory/sessions`,
 * with a `session_start` line that already carries a human title — no heuristics
 * needed. Sessions are filed both flat and under a cwd-named directory; only the
 * directory form can be scoped to a repo, which is what we read.
 */
export const droidHistory: LocalHistoryProvider = {
  id: "factory-droid",

  async list(cwds: string[], since: number): Promise<LocalSession[]> {
    const found = await Promise.all(
      cwds.map(async (cwd) => {
        const dir = join(homedir(), ".factory", "sessions", projectDirFor(cwd));
        let entries: string[];
        try {
          entries = await readdir(dir);
        } catch {
          return [];
        }

        const sessions = await mapWithConcurrency(
          entries.filter((e) => e.endsWith(".jsonl")),
          FILE_CONCURRENCY,
          (entry) => readSession(join(dir, entry), entry, cwd, since),
        );
        return sessions.filter((s): s is LocalSession => s !== null);
      }),
    );

    return found.flat();
  },
};

async function readSession(
  path: string,
  entry: string,
  cwd: string,
  since: number,
): Promise<LocalSession | null> {
  try {
    const { head, sizeBytes, modifiedAt } = await readHead(path);
    if (modifiedAt < since) return null;

    const lines = head.split("\n");
    let title: string | null = null;
    let sessionId = entry.replace(/\.jsonl$/, "");
    let startedAt: number | null = null;

    for (const raw of lines) {
      if (!raw.startsWith("{")) continue;
      try {
        const line = JSON.parse(raw) as StartLine & MessageLine;
        if (line.type === "session_start") {
          if (line.title) title = line.title;
          if (line.id) sessionId = line.id;
        }
        if (line.timestamp && startedAt === null) {
          startedAt = Math.floor(Date.parse(line.timestamp) / 1000);
        }
      } catch {
        // truncated tail of the head read
      }
      if (title && startedAt !== null) break;
    }

    return {
      provider: "factory-droid",
      sessionId,
      title,
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
