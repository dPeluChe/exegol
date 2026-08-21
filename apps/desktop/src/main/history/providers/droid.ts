import { homedir } from "node:os";
import { join } from "node:path";
import { scanPerCwdDir } from "../pool";
import { readHead } from "../read-head";
import { type LocalHistoryProvider, type LocalSession, normalizeTitle } from "../types";

/**
 * Factory names a session directory after its cwd — but unlike Claude Code it
 * replaces ONLY `/`, leaving underscores intact (`…-dPeluChe-_code_-labs_irma`).
 * Two CLIs, two slug rules; assuming they matched found nothing at all.
 */
function projectDirFor(cwd: string): string {
  return cwd.replace(/\//g, "-");
}

const DROID_HEAD_BYTES = 16 * 1024;

interface DroidLine {
  type?: string;
  id?: string;
  title?: string;
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

  list(cwds: string[], since: number): Promise<LocalSession[]> {
    return scanPerCwdDir(cwds, {
      dirFor: (cwd) => join(homedir(), ".factory", "sessions", projectDirFor(cwd)),
      ext: ".jsonl",
      read: (path, entry, cwd) => readSession(path, entry, cwd, since),
    });
  },
};

async function readSession(
  path: string,
  entry: string,
  cwd: string,
  since: number,
): Promise<LocalSession | null> {
  try {
    // The title and id are on line 1 and the first timestamp on line 2 —
    // measured at well under 11 KB together. The default 64 KB head read 14 MB
    // across the busiest directory on this machine (221 sessions) to use ~200
    // bytes of each.
    const { head, sizeBytes, modifiedAt } = await readHead(path, DROID_HEAD_BYTES);
    if (modifiedAt < since) return null;

    let title: string | null = null;
    let sessionId = entry.replace(/\.jsonl$/, "");
    let startedAt: number | null = null;

    for (const raw of head.split("\n")) {
      if (!raw.startsWith("{")) continue;
      try {
        const line = JSON.parse(raw) as DroidLine;
        if (line.type === "session_start") {
          if (line.title) title = normalizeTitle(line.title);
          if (line.id) sessionId = line.id;
        }
        if (line.timestamp && startedAt === null) {
          startedAt = Math.floor(Date.parse(line.timestamp) / 1000);
        }
      } catch {
        // truncated tail of a partial read
      }
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
