import { PLATFORM } from "./keymap";

/**
 * T155: drag a file from FileExplorer / GitPane and drop it on a terminal
 * pane — it lands as an `@rel/path ` mention (Claude's native attachment
 * syntax); files outside the project, and files dropped from Finder, land as
 * quoted absolute paths.
 */

export const FILE_DRAG_MIME = "application/x-exegol-file";

interface FileDragItem {
  /** project- or repo-relative path (preferred: becomes an @mention) */
  relPath?: string;
  absPath?: string;
}

export function setFileDragData(e: React.DragEvent, items: FileDragItem[]): void {
  e.dataTransfer.setData(FILE_DRAG_MIME, JSON.stringify(items));
  e.dataTransfer.effectAllowed = "copy";
}

/** Exegol's own file drags, or files from Finder */
export function hasFileDragData(e: React.DragEvent): boolean {
  const types = e.dataTransfer.types;
  return types.includes(FILE_DRAG_MIME) || types.includes("Files");
}

/** A path a CLI on this OS reads as one word; Windows quotes only with `"` and names no file with it */
export function quotePath(p: string, platform = PLATFORM): string {
  if (!/[\s'"]/.test(p)) return p;
  return platform === "win32" ? `"${p}"` : `'${p.replace(/'/g, "'\\''")}'`;
}

/** Files from Finder, dropped or pasted: absolute paths, quoted when they need it */
export function finderFilesToPaste(data: DataTransfer): string | null {
  const paths = Array.from(data.files)
    .map((f) => window.api?.pathForFile?.(f))
    .filter((p): p is string => !!p);
  return paths.length ? `${paths.map((p) => quotePath(p)).join(" ")} ` : null;
}

/** Build the text to paste into the terminal, trailing space included. */
export function fileDragToPaste(e: React.DragEvent): string | null {
  const raw = e.dataTransfer.getData(FILE_DRAG_MIME);
  if (!raw) return finderFilesToPaste(e.dataTransfer);
  try {
    const items = JSON.parse(raw) as FileDragItem[];
    const parts = items
      .map((i) => (i.relPath ? `@${i.relPath}` : i.absPath ? quotePath(i.absPath) : null))
      .filter(Boolean);
    return parts.length ? `${parts.join(" ")} ` : null;
  } catch {
    return null;
  }
}
