import { readdir, readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { FILE_CONCURRENCY, mapWithConcurrency } from "../pool";
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

    let projectDirs: string[];
    try {
      projectDirs = await readdir(root);
    } catch {
      return [];
    }

    const paths = (
      await Promise.all(
        projectDirs.map(async (projectDir) => {
          const dir = join(root, projectDir);
          try {
            return (await readdir(dir)).filter((f) => f.endsWith(".json")).map((f) => join(dir, f));
          } catch {
            return [];
          }
        }),
      )
    ).flat();

    const sessions = await mapWithConcurrency(paths, FILE_CONCURRENCY, (path) =>
      readSession(path, cwds, since),
    );
    return sessions.filter((s): s is LocalSession => s !== null);
  },
};

async function readSession(
  path: string,
  cwds: string[],
  since: number,
): Promise<LocalSession | null> {
  try {
    const raw = await readFile(path, "utf-8");
    // Cheap reject before parsing: most sessions belong to other directories.
    if (!cwds.some((cwd) => raw.includes(`"${cwd}"`))) return null;

    const parsed = JSON.parse(raw) as OpencodeSession;
    if (!parsed.directory || !cwds.includes(parsed.directory)) return null;

    // `time` is in milliseconds; mtime covers stores that omit it.
    const updated = parsed.time?.updated
      ? Math.floor(parsed.time.updated / 1000)
      : Math.floor((await stat(path)).mtimeMs / 1000);
    if (updated < since) return null;

    return {
      provider: "opencode",
      sessionId:
        parsed.id ??
        path
          .split("/")
          .pop()
          ?.replace(/\.json$/, "") ??
        path,
      title: parsed.title ?? null,
      cwd: parsed.directory,
      branch: null,
      startedAt: parsed.time?.created ? Math.floor(parsed.time.created / 1000) : null,
      endedAt: updated,
      version: parsed.version ?? null,
      sizeBytes: raw.length,
    };
  } catch {
    return null; // unreadable session file — skip it
  }
}
