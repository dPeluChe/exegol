import type { DiffLine } from "./diff-parser";

interface SplitRow {
  left: DiffLine | null;
  right: DiffLine | null;
}

/**
 * Pairs hunk lines into side-by-side rows: context on both sides, a deletion run
 * lined up against the addition run that follows it, lone additions on the right.
 */
export function pairSplitRows(lines: DiffLine[]): SplitRow[] {
  const rows: SplitRow[] = [];

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line) {
      i++;
      continue;
    }

    if (line.type === "context") {
      rows.push({ left: line, right: line });
      i++;
    } else if (line.type === "deletion") {
      const deletions: DiffLine[] = [];
      while (i < lines.length && lines[i]?.type === "deletion") {
        const del = lines[i];
        if (del) deletions.push(del);
        i++;
      }
      const additions: DiffLine[] = [];
      while (i < lines.length && lines[i]?.type === "addition") {
        const add = lines[i];
        if (add) additions.push(add);
        i++;
      }
      const maxLen = Math.max(deletions.length, additions.length);
      for (let j = 0; j < maxLen; j++) {
        rows.push({
          left: j < deletions.length ? (deletions[j] ?? null) : null,
          right: j < additions.length ? (additions[j] ?? null) : null,
        });
      }
    } else if (line.type === "addition") {
      rows.push({ left: null, right: line });
      i++;
    } else {
      i++;
    }
  }

  return rows;
}
