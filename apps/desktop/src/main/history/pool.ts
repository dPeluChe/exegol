import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { mapWithConcurrency } from "../lib/concurrency";

/** Reads are I/O-bound with a small sync parse; past this the parses queue up. */
export const FILE_CONCURRENCY = 16;

/**
 * The shape every store keyed by a cwd-named directory shares: find the
 * directory for each cwd, read its files, drop what does not parse.
 *
 * Only three things actually differ between claude-code, droid and gemini —
 * how the directory name is derived, which extension counts, and how one file
 * becomes a session. Everything else was copied twice, so a fix to the readdir
 * error path had to be made three times.
 */
export async function scanPerCwdDir<T>(
  cwds: string[],
  spec: {
    dirFor: (cwd: string) => string;
    ext: string;
    read: (path: string, entry: string, cwd: string) => Promise<T | null>;
  },
): Promise<T[]> {
  const found = await Promise.all(
    cwds.map(async (cwd) => {
      const dir = spec.dirFor(cwd);
      let entries: string[];
      try {
        entries = await readdir(dir);
      } catch {
        return []; // this CLI has no history for this directory — normal
      }
      const results = await mapWithConcurrency(
        entries.filter((e) => e.endsWith(spec.ext)),
        FILE_CONCURRENCY,
        (entry) => spec.read(join(dir, entry), entry, cwd),
      );
      return results.filter((r): r is T => r !== null);
    }),
  );
  return found.flat();
}

/**
 * Does this raw text name one of these directories? A cheap reject before an
 * expensive parse — most files in a store belong to other repos, and the three
 * adapters that scan flat stores each wrote this line by hand.
 */
export function mentionsAnyCwd(text: string, cwds: string[]): boolean {
  return cwds.some((cwd) => text.includes(`"${cwd}"`));
}
