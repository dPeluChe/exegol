import { readdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { FILE_CONCURRENCY, mapWithConcurrency } from "../pool";
import { readHead } from "../read-head";
import type { LocalHistoryProvider, LocalSession } from "../types";

/** goose's first line is a header, and it is the richest of any CLI here: the
 *  working directory, a written description, and real token counts. */
interface GooseHeader {
  working_dir?: string;
  description?: string;
  message_count?: number;
  total_tokens?: number;
  input_tokens?: number;
  output_tokens?: number;
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
    const { head, sizeBytes, modifiedAt } = await readHead(path);
    if (modifiedAt < since) return null;

    const firstLine = head.split("\n", 1)[0];
    if (!firstLine) return null;
    // Cheap reject before parsing: most sessions belong to other directories.
    if (!cwds.some((cwd) => firstLine.includes(`"${cwd}"`))) return null;

    const header = JSON.parse(firstLine) as GooseHeader;
    if (!header.working_dir || !cwds.includes(header.working_dir)) return null;

    return {
      provider: "goose",
      sessionId: entry.replace(/\.jsonl$/, ""),
      // The description is goose's own summary of the conversation.
      title: header.description?.replace(/\s+/g, " ").trim().slice(0, 120) ?? null,
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
