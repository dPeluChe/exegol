import { realpathOr, runCliListing } from "../cli-list";
import { type LocalHistoryProvider, type LocalSession, normalizeTitle } from "../types";

interface DevinListEntry {
  id?: string;
  working_directory?: string;
  last_activity_at?: number;
  title?: string;
}

/**
 * `devin list --format json` in a folder: a JSON array, `[]` when there is none. devin keeps no
 * plain-file store to read, so its own listing is the source and agrees with what `devin -c` sees.
 */
export function parseDevinList(
  stdout: string,
  cwd: string,
  realCwd: string,
  since: number,
): LocalSession[] {
  if (!stdout.trim()) return [];
  const parsed: unknown = JSON.parse(stdout);
  if (!Array.isArray(parsed)) return [];
  return (parsed as DevinListEntry[]).flatMap((e) => {
    if (!e.id || (e.working_directory !== cwd && e.working_directory !== realCwd)) return [];
    const at = typeof e.last_activity_at === "number" ? e.last_activity_at : null;
    if (at !== null && at < since) return [];
    return [
      {
        provider: "devin",
        sessionId: e.id,
        title: normalizeTitle(e.title),
        cwd,
        branch: null,
        startedAt: null,
        endedAt: at,
        version: null,
        sizeBytes: 0,
      },
    ];
  });
}

async function listIn(cwd: string, since: number): Promise<LocalSession[]> {
  const stdout = await runCliListing("devin", ["list", "--format", "json"], cwd);
  return parseDevinList(stdout, cwd, await realpathOr(cwd), since);
}

export const devinHistory: LocalHistoryProvider = {
  id: "devin",

  async list(cwds: string[], since: number): Promise<LocalSession[]> {
    return (await Promise.all(cwds.map((cwd) => listIn(cwd, since)))).flat();
  },
};
