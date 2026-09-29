import { useCallback, useState } from "react";
import type { DiffFile } from "./diff-parser";

const NO_FILES: ReadonlySet<string> = new Set();

/** Which files of the current diff are expanded; new diff data starts collapsed. */
export function useExpandedDiffFiles(rawDiff: string | null | undefined, parsedFiles: DiffFile[]) {
  // Expanded files belong to the diff they were opened in: new diff data starts collapsed
  const [expanded, setExpanded] = useState<{ diff: typeof rawDiff; files: ReadonlySet<string> }>({
    diff: rawDiff,
    files: new Set(),
  });
  const expandedFiles = expanded.diff === rawDiff ? expanded.files : NO_FILES;
  const setExpandedFiles = useCallback(
    (next: ReadonlySet<string> | ((prev: ReadonlySet<string>) => ReadonlySet<string>)) =>
      setExpanded((prev) => ({
        diff: rawDiff,
        files:
          typeof next === "function" ? next(prev.diff === rawDiff ? prev.files : NO_FILES) : next,
      })),
    [rawDiff],
  );

  const allExpanded =
    parsedFiles.length > 0 && parsedFiles.every((f) => expandedFiles.has(f.newPath));
  const toggleAll = useCallback(() => {
    if (allExpanded) {
      setExpandedFiles(new Set());
    } else {
      setExpandedFiles(new Set(parsedFiles.map((f) => f.newPath)));
    }
  }, [allExpanded, parsedFiles, setExpandedFiles]);

  const toggleFile = useCallback(
    (path: string) => {
      setExpandedFiles((prev) => {
        const next = new Set(prev);
        if (next.has(path)) next.delete(path);
        else next.add(path);
        return next;
      });
    },
    [setExpandedFiles],
  );

  return { expandedFiles, allExpanded, toggleAll, toggleFile };
}
