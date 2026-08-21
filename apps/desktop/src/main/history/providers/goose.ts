import { readdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { FILE_CONCURRENCY, mapWithConcurrency, mentionsAnyCwd } from "../pool";
import { readHead } from "../read-head";
import { type LocalHistoryProvider, type LocalSession, normalizeTitle } from "../types";

const GOOSE_HEAD_BYTES = 8 * 1024;

/** goose's first line is a header carrying the working directory and its own
 *  written summary. (It also records token counts, which `LocalSession` has
 *  nowhere to put — left out rather than declared and dropped.) */
interface GooseHeader {
  working_dir?: string;
  description?: string;
}

export const gooseHistory: LocalHistoryProvider = {
  id: "goose",

  async list(cwds: string[], since: number): Promise<LocalSession[]> {
    const dir = join(homedir(), ".local", "share", "goose", "sessions");
    let entries: string[];
    try {
      entries = await readdir(dir);
    } catch {
      return [];
    }

    const sessions = await mapWithConcurrency(
      entries.filter((e) => e.endsWith(".jsonl")),
      FILE_CONCURRENCY,
      (entry) => readSession(join(dir, entry), entry, cwds, since),
    );
    return sessions.filter((s): s is LocalSession => s !== null);
  },
};

/** `20250731_173208.jsonl` — the only start time goose records is its name. */
function startedAtFromName(entry: string): number | null {
  const match = entry.match(/^(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})/);
  if (!match) return null;
  const [, y, mo, d, h, mi, s] = match;
  const stamp = new Date(`${y}-${mo}-${d}T${h}:${mi}:${s}`).getTime();
  return Number.isNaN(stamp) ? null : Math.floor(stamp / 1000);
}

async function readSession(
  path: string,
  entry: string,
  cwds: string[],
  since: number,
): Promise<LocalSession | null> {
  try {
    // Only the header line is ever read, and the largest measured is 422 bytes.
    // goose's directory is flat and cannot be scoped by cwd, so EVERY session in
    // the user's whole goose history is opened on every scan — the head size is
    // multiplied by their history, not by this repo's.
    const { head, sizeBytes, modifiedAt } = await readHead(path, GOOSE_HEAD_BYTES);
    if (modifiedAt < since) return null;

    const firstLine = head.split("\n", 1)[0];
    if (!firstLine) return null;
    if (!mentionsAnyCwd(firstLine, cwds)) return null;

    const header = JSON.parse(firstLine) as GooseHeader;
    if (!header.working_dir || !cwds.includes(header.working_dir)) return null;

    return {
      provider: "goose",
      sessionId: entry.replace(/\.jsonl$/, ""),
      title: normalizeTitle(header.description),
      cwd: header.working_dir,
      branch: null,
      startedAt: startedAtFromName(entry),
      endedAt: modifiedAt,
      version: null,
      sizeBytes,
    };
  } catch {
    return null;
  }
}
