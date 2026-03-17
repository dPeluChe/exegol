export interface DiffLine {
  type: "context" | "addition" | "deletion" | "header";
  content: string;
  oldLineNumber: number | null;
  newLineNumber: number | null;
}

export interface DiffHunk {
  header: string;
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
  lines: DiffLine[];
}

export interface DiffFile {
  oldPath: string;
  newPath: string;
  hunks: DiffHunk[];
  isNew: boolean;
  isDeleted: boolean;
}

export function parseUnifiedDiff(raw: string): DiffFile[] {
  if (!raw.trim()) return [];

  const files: DiffFile[] = [];
  const lines = raw.split("\n");
  let i = 0;

  while (i < lines.length) {
    // Look for "diff --git" header
    if (!lines[i]?.startsWith("diff --git")) {
      i++;
      continue;
    }

    const file: DiffFile = {
      oldPath: "",
      newPath: "",
      hunks: [],
      isNew: false,
      isDeleted: false,
    };

    i++; // skip "diff --git" line

    // Parse file metadata lines (old mode, new mode, index, etc.)
    while (
      i < lines.length &&
      !lines[i]?.startsWith("---") &&
      !lines[i]?.startsWith("diff --git") &&
      !lines[i]?.startsWith("@@")
    ) {
      const line = lines[i] ?? "";
      if (line.startsWith("new file")) file.isNew = true;
      if (line.startsWith("deleted file")) file.isDeleted = true;
      i++;
    }

    // Parse --- and +++ lines
    if (i < lines.length && lines[i]?.startsWith("---")) {
      file.oldPath = (lines[i]?.slice(4) ?? "").replace(/^a\//, "");
      i++;
    }
    if (i < lines.length && lines[i]?.startsWith("+++")) {
      file.newPath = (lines[i]?.slice(4) ?? "").replace(/^b\//, "");
      i++;
    }

    // Parse hunks
    while (i < lines.length && !lines[i]?.startsWith("diff --git")) {
      const line = lines[i] ?? "";
      if (line.startsWith("@@")) {
        const hunk = parseHunkHeader(line);
        i++;

        // Parse hunk lines
        let oldLine = hunk.oldStart;
        let newLine = hunk.newStart;

        while (
          i < lines.length &&
          !lines[i]?.startsWith("@@") &&
          !lines[i]?.startsWith("diff --git")
        ) {
          const hunkLine = lines[i] ?? "";
          const prefix = hunkLine[0];

          if (prefix === "+") {
            hunk.lines.push({
              type: "addition",
              content: hunkLine.slice(1),
              oldLineNumber: null,
              newLineNumber: newLine++,
            });
          } else if (prefix === "-") {
            hunk.lines.push({
              type: "deletion",
              content: hunkLine.slice(1),
              oldLineNumber: oldLine++,
              newLineNumber: null,
            });
          } else if (prefix === " " || prefix === undefined) {
            // Context line or empty trailing line
            if (hunkLine.length > 0) {
              hunk.lines.push({
                type: "context",
                content: hunkLine.slice(1),
                oldLineNumber: oldLine++,
                newLineNumber: newLine++,
              });
            }
          } else if (prefix === "\\") {
            // "\ No newline at end of file" — skip
          } else {
            // Unknown prefix, treat as context
            hunk.lines.push({
              type: "context",
              content: hunkLine,
              oldLineNumber: oldLine++,
              newLineNumber: newLine++,
            });
          }
          i++;
        }

        file.hunks.push(hunk);
      } else {
        i++;
      }
    }

    // Use newPath as display path, fall back to oldPath
    if (!file.newPath || file.newPath === "/dev/null") {
      file.newPath = file.oldPath;
    }
    if (!file.oldPath || file.oldPath === "/dev/null") {
      file.oldPath = file.newPath;
    }

    files.push(file);
  }

  return files;
}

function parseHunkHeader(line: string): DiffHunk {
  // Format: @@ -oldStart,oldCount +newStart,newCount @@ optional context
  const match = line.match(/@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)/);
  if (!match) {
    return { header: line, oldStart: 0, oldCount: 0, newStart: 0, newCount: 0, lines: [] };
  }

  return {
    header: line,
    oldStart: Number(match[1]),
    oldCount: match[2] !== undefined ? Number(match[2]) : 1,
    newStart: Number(match[3]),
    newCount: match[4] !== undefined ? Number(match[4]) : 1,
    lines: [],
  };
}
