/**
 * T174 — fit a diff into an LLM prompt without letting one file starve the rest.
 *
 * Every caller used to do `diff.slice(0, N)`. That is head truncation: a
 * regenerated lockfile or a snapshot test sorts near the top and eats the whole
 * budget, so the model reviews — or writes a commit message about — changes it
 * never saw. The hand-authored code is exactly what gets dropped.
 *
 * Instead: split per file, water-fill the budget across sections (slack from
 * files that fit is handed back to files that don't), and clip each section on
 * a line boundary with an explicit marker, so the model never sees half a diff
 * line and always knows something was omitted. Adapted from Orca's
 * `truncateDiffForPrompt`.
 */

const FILE_BOUNDARY = "\ndiff --git ";

/** Default budget in characters. Roughly 5k tokens — enough for a real review,
 *  small enough that a judge call stays cheap. */
const DEFAULT_DIFF_BUDGET = 20_000;

function splitIntoFileSections(diff: string): string[] {
  const sections: string[] = [];
  let start = 0;
  let next = diff.indexOf(FILE_BOUNDARY);
  while (next !== -1) {
    // Keep the newline with the preceding section so joining restores the diff.
    sections.push(diff.slice(start, next + 1));
    start = next + 1;
    next = diff.indexOf(FILE_BOUNDARY, start);
  }
  sections.push(diff.slice(start));
  return sections;
}

function clipOnLineBoundary(section: string, limit: number): string {
  if (section.length <= limit) return section;
  if (limit <= 0) return "";

  const markerFor = (omitted: number) => `\n...(diff truncated, ${omitted} characters omitted)\n`;
  const provisional = markerFor(section.length);
  if (provisional.length >= limit) return provisional.slice(0, limit);

  const target = limit - provisional.length;
  const lineBreak = section.lastIndexOf("\n", target);
  // Only honour the line boundary if it doesn't throw away most of the budget —
  // one very long line would otherwise collapse the section to nothing.
  const cut = lineBreak > target / 2 ? lineBreak : target;
  return `${section.slice(0, cut)}${markerFor(section.length - cut)}`;
}

/**
 * Water-fill: repeatedly give every still-hungry section an equal share of what
 * is left. Sections that need less than their share take only what they need
 * and drop out, returning the remainder to the others — so a hundred one-line
 * changes all survive alongside one enormous file.
 */
function allocateFairly(sizes: number[], budget: number): number[] {
  const alloc = new Array<number>(sizes.length).fill(0);
  let active = sizes.map((_, i) => i);
  let remaining = budget;

  while (active.length > 0 && remaining > 0) {
    const share = Math.floor(remaining / active.length);
    if (share === 0) break; // less than one character each — stop, don't spin
    const stillHungry: number[] = [];
    for (const i of active) {
      const need = (sizes[i] ?? 0) - (alloc[i] ?? 0);
      const grant = Math.min(need, share);
      alloc[i] = (alloc[i] ?? 0) + grant;
      remaining -= grant;
      if (grant < need) stillHungry.push(i);
    }
    active = stillHungry;
  }
  return alloc;
}

/** Fit `diff` into `budget` characters, preserving a slice of every file. */
export function truncateDiffForPrompt(diff: string, budget = DEFAULT_DIFF_BUDGET): string {
  if (diff.length <= budget) return diff;
  const sections = splitIntoFileSections(diff);
  const allocations = allocateFairly(
    sections.map((s) => s.length),
    budget,
  );
  return sections.map((s, i) => clipOnLineBoundary(s, allocations[i] ?? 0)).join("");
}
