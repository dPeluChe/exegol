import { z } from "zod";
import { cliListing, eachCwd, realpathOr } from "../cli-list";
import { type LocalHistoryProvider, type LocalSession, normalizeTitle } from "../types";

/** `devin list --format json` (verified 2026-10-08): `[]` when the folder has none */
const devinListSchema = z.array(
  z.object({
    id: z.string(),
    working_directory: z.string(),
    last_activity_at: z.number().nullish(),
    title: z.string().nullish(),
  }),
);
type DevinEntry = z.infer<typeof devinListSchema>[number];

/** Sessions recorded in `cwd` (or its realpath) and active since `since`, reported under `cwd` */
export function devinSessions(
  entries: DevinEntry[],
  cwd: string,
  realCwd: string,
  since: number,
): LocalSession[] {
  return entries.flatMap((e) => {
    if (e.working_directory !== cwd && e.working_directory !== realCwd) return [];
    const at = e.last_activity_at ?? null;
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

/** devin keeps no plain-file store to read; its own listing agrees with what `devin -c` sees */
export const devinHistory: LocalHistoryProvider = {
  id: "devin",

  list(cwds: string[], since: number): Promise<LocalSession[]> {
    return eachCwd(cwds, async (cwd) => {
      const entries = await cliListing(
        "devin",
        "devin",
        ["list", "--format", "json"],
        cwd,
        devinListSchema,
      );
      return devinSessions(entries, cwd, await realpathOr(cwd), since);
    });
  },
};
