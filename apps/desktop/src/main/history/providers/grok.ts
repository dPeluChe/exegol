import { readdir, readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { parseJson } from "../../lib/parse-json";
import { realpathOr } from "../cli-list";
import { scanPerCwdDir } from "../pool";
import { type LocalHistoryProvider, type LocalSession, normalizeTitle } from "../types";

const summarySchema = z.object({
  generated_title: z.string().nullish(),
  session_summary: z.string().nullish(),
  head_branch: z.string().nullish(),
  created_at: z.string().nullish(),
  updated_at: z.string().nullish(),
  last_active_at: z.string().nullish(),
  num_chat_messages: z.number().nullish(),
});

const sessionsRoot = () => join(homedir(), ".grok", "sessions");

const seconds = (iso: string | null | undefined): number | null => {
  const ms = iso ? Date.parse(iso) : Number.NaN;
  return Number.isNaN(ms) ? null : Math.floor(ms / 1000);
};

function decoded(name: string): string | null {
  try {
    return decodeURIComponent(name);
  } catch {
    return null;
  }
}

/** Each cwd's folder: names are compared decoded, since only `/` is seen encoded in real stores */
async function folderOf(cwds: string[]): Promise<Map<string, string>> {
  let names: string[];
  try {
    names = await readdir(sessionsRoot());
  } catch {
    return new Map();
  }
  const byPath = new Map(names.map((name) => [decoded(name), name]));
  const found = await Promise.all(
    cwds.map(async (cwd) => [cwd, byPath.get(await realpathOr(cwd))] as const),
  );
  return new Map(found.flatMap(([cwd, name]) => (name ? [[cwd, name] as const] : [])));
}

/** Grok files each session as a folder under its cwd, with `summary.json` as the index entry */
export const grokHistory: LocalHistoryProvider = {
  id: "grok",

  async list(cwds: string[], since: number): Promise<LocalSession[]> {
    const folders = await folderOf(cwds);
    return scanPerCwdDir([...folders.keys()], {
      dirFor: (cwd) => join(sessionsRoot(), folders.get(cwd) ?? ""),
      ext: "",
      read: (path, entry, cwd) => readSession(path, entry, cwd, since),
    });
  },
};

async function readSession(
  dir: string,
  sessionId: string,
  cwd: string,
  since: number,
): Promise<LocalSession | null> {
  try {
    const summary = parseJson(await readFile(join(dir, "summary.json"), "utf8"), summarySchema);
    // A session that never took a prompt has nothing to resume
    if (!summary?.num_chat_messages) return null;
    const endedAt = seconds(summary.last_active_at ?? summary.updated_at);
    if (endedAt === null || endedAt < since) return null;
    const { size } = await stat(join(dir, "updates.jsonl"));
    return {
      provider: "grok",
      sessionId,
      title: normalizeTitle(summary.generated_title ?? summary.session_summary),
      cwd,
      branch: summary.head_branch ?? null,
      startedAt: seconds(summary.created_at),
      endedAt,
      version: null,
      sizeBytes: size,
    };
  } catch {
    return null;
  }
}
