import { readdir, readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { LocalHistoryProvider, LocalSession } from "../types";

interface OpencodeSession {
  id?: string;
  version?: string;
  directory?: string;
  title?: string;
  time?: { created?: number; updated?: number };
}

/** opencode stores one small JSON per session under a per-project hash dir, so
 *  unlike the transcript formats these can simply be read whole. */
export const opencodeHistory: LocalHistoryProvider = {
  id: "opencode",

  async list(cwds: string[], since: number): Promise<LocalSession[]> {
    const root = join(homedir(), ".local", "share", "opencode", "storage", "session");
    const wanted = new Set(cwds);
    const sessions: LocalSession[] = [];

    let projectDirs: string[];
    try {
      projectDirs = await readdir(root);
    } catch {
      return [];
    }

    for (const projectDir of projectDirs) {
      const dir = join(root, projectDir);
      let files: string[];
      try {
        files = await readdir(dir);
      } catch {
        continue;
      }

      for (const file of files) {
        if (!file.endsWith(".json")) continue;
        const path = join(dir, file);
        try {
          const parsed = JSON.parse(await readFile(path, "utf-8")) as OpencodeSession;
          if (!parsed.directory || !wanted.has(parsed.directory)) continue;

          // `time` is in milliseconds; mtime covers stores that omit it.
          const updated = parsed.time?.updated
            ? Math.floor(parsed.time.updated / 1000)
            : Math.floor((await stat(path)).mtimeMs / 1000);
          if (updated < since) continue;

          sessions.push({
            provider: "opencode",
            sessionId: parsed.id ?? file.replace(/\.json$/, ""),
            title: parsed.title ?? null,
            cwd: parsed.directory,
            branch: null,
            startedAt: parsed.time?.created ? Math.floor(parsed.time.created / 1000) : null,
            endedAt: updated,
            version: parsed.version ?? null,
            sizeBytes: 0,
          });
        } catch {
          // Unreadable session file — skip it.
        }
      }
    }

    return sessions;
  },
};
