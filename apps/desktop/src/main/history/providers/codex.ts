import { readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { readHead } from "../read-head";
import type { LocalHistoryProvider, LocalSession } from "../types";

interface SessionMeta {
  type?: string;
  timestamp?: string;
  payload?: {
    session_id?: string;
    cwd?: string;
    timestamp?: string;
    cli_version?: string;
    git?: { branch?: string };
  };
}

/** `sessions/YYYY/MM/DD/rollout-*.jsonl` — the date is in the PATH, so a
 *  30-day window skips whole directories instead of stat-ing 700 files. */
function withinWindow(year: string, month: string, day: string, since: number): boolean {
  const parsed = Date.parse(`${year}-${month}-${day}T23:59:59Z`);
  return Number.isNaN(parsed) || Math.floor(parsed / 1000) >= since;
}

async function subdirs(path: string): Promise<string[]> {
  try {
    const entries = await readdir(path, { withFileTypes: true });
    return entries.filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    return [];
  }
}

export const codexHistory: LocalHistoryProvider = {
  id: "codex",

  async list(cwds: string[], since: number): Promise<LocalSession[]> {
    const root = join(homedir(), ".codex", "sessions");
    const wanted = new Set(cwds);
    const sessions: LocalSession[] = [];

    for (const year of await subdirs(root)) {
      for (const month of await subdirs(join(root, year))) {
        for (const day of await subdirs(join(root, year, month))) {
          if (!withinWindow(year, month, day, since)) continue;
          const dir = join(root, year, month, day);
          let files: string[];
          try {
            files = await readdir(dir);
          } catch {
            continue;
          }

          for (const file of files) {
            if (!file.endsWith(".jsonl")) continue;
            const path = join(dir, file);
            try {
              // Only the first line matters — but it embeds the model's full
              // base_instructions, so it runs past 20 KB. Read short and the
              // line is truncated, JSON.parse fails, and every codex session
              // silently disappears from the timeline (measured: 15-22 KB).
              const head = await readHead(path, 64 * 1024);
              const firstLine = head.split("\n", 1)[0];
              if (!firstLine) continue;
              const meta = JSON.parse(firstLine) as SessionMeta;
              const cwd = meta.payload?.cwd;
              if (!cwd || !wanted.has(cwd)) continue;

              const info = await stat(path);
              const started = meta.payload?.timestamp ?? meta.timestamp;
              sessions.push({
                provider: "codex",
                sessionId: meta.payload?.session_id ?? file.replace(/\.jsonl$/, ""),
                // codex records no title; the rollout is identified by when it
                // ran and, usefully, by the branch it ran against.
                title: null,
                cwd,
                branch: meta.payload?.git?.branch ?? null,
                startedAt: started ? Math.floor(Date.parse(started) / 1000) : null,
                endedAt: Math.floor(info.mtimeMs / 1000),
                version: meta.payload?.cli_version ?? null,
                sizeBytes: info.size,
              });
            } catch {
              // Malformed or unreadable rollout — skip it.
            }
          }
        }
      }
    }

    return sessions;
  },
};
