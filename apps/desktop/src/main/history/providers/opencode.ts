import { readdir, readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { mapWithConcurrency } from "../../lib/concurrency";
import { cliListing, realpathOr } from "../cli-list";
import { FILE_CONCURRENCY, mentionsAnyCwd } from "../pool";
import {
  type LocalHistoryProvider,
  type LocalSession,
  normalizeTitle,
  StoreUnavailable,
} from "../types";

interface OpencodeSession {
  id?: string;
  version?: string;
  directory?: string;
  title?: string;
  time?: { created?: number; updated?: number };
}

/** `opencode session list --format json` (verified 2026-10-08); Kilo prints the same */
const opencodeListSchema = z.array(
  z.object({
    id: z.string(),
    title: z.string().nullish(),
    updated: z.number().nullish(),
    created: z.number().nullish(),
    directory: z.string(),
  }),
);
type OpencodeEntry = z.infer<typeof opencodeListSchema>[number];

/** Keeps the sessions recorded in one of the cwds; `real` maps a recorded path (a cwd or its
 *  realpath) to that cwd */
export function opencodeSessions(
  entries: OpencodeEntry[],
  real: Map<string, string>,
  since: number,
  provider = "opencode",
): LocalSession[] {
  return entries.flatMap((e) => {
    const cwd = real.get(e.directory);
    if (!cwd) return [];
    const updated = e.updated != null ? Math.floor(e.updated / 1000) : null;
    if (updated !== null && updated < since) return [];
    return [
      {
        provider,
        sessionId: e.id,
        title: normalizeTitle(e.title),
        cwd,
        branch: null,
        startedAt: e.created != null ? Math.floor(e.created / 1000) : null,
        endedAt: updated,
        version: null,
        sizeBytes: 0,
      },
    ];
  });
}

const LIST_ARGS = ["session", "list", "--format", "json", "--pure"];

/**
 * The listing holds every session of the git project the folder belongs to (all its worktrees),
 * or outside git of one "global" project: one run, in the first cwd that lists (the project
 * path), covers every cwd. Kilo Code is an opencode fork with the same listing
 */
export async function listViaCli(
  command: string,
  provider: string,
  cwds: string[],
  since: number,
): Promise<LocalSession[]> {
  const real = new Map<string, string>();
  for (const cwd of cwds) {
    real.set(cwd, cwd);
    real.set(await realpathOr(cwd), cwd);
  }
  let lastError: unknown = new StoreUnavailable(`${command}: no folder to list from`);
  for (const cwd of cwds) {
    try {
      const entries = await cliListing(provider, command, LIST_ARGS, cwd, opencodeListSchema);
      return opencodeSessions(entries, real, since, provider);
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError;
}

/**
 * opencode 1.x keeps sessions in a SQLite db; the per-session JSON files stopped changing (Feb 2026
 * here), so reading them missed every newer session. Its own listing is the source, the JSON
 * files the fallback when opencode is not installed
 */
export const opencodeHistory: LocalHistoryProvider = {
  id: "opencode",

  async list(cwds: string[], since: number): Promise<LocalSession[]> {
    try {
      return await listViaCli("opencode", "opencode", cwds, since);
    } catch (err) {
      if (!(err instanceof StoreUnavailable)) throw err;
      return listFromStore(cwds, since);
    }
  },
};

async function listFromStore(cwds: string[], since: number): Promise<LocalSession[]> {
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
}

async function readSession(
  path: string,
  cwds: string[],
  since: number,
): Promise<LocalSession | null> {
  try {
    const raw = await readFile(path, "utf-8");
    if (!mentionsAnyCwd(raw, cwds)) return null;

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
      title: normalizeTitle(parsed.title),
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
