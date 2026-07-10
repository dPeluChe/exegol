/**
 * T155: drag a file from FileExplorer / GitPane and drop it on a terminal
 * pane — it lands as an `@rel/path ` mention (Claude's native attachment
 * syntax); files outside the project land as quoted absolute paths.
 */

export const FILE_DRAG_MIME = "application/x-exegol-file";

export interface FileDragItem {
  /** project- or repo-relative path (preferred: becomes an @mention) */
  relPath?: string;
  absPath?: string;
}

export function setFileDragData(e: React.DragEvent, items: FileDragItem[]): void {
  e.dataTransfer.setData(FILE_DRAG_MIME, JSON.stringify(items));
  e.dataTransfer.effectAllowed = "copy";
}

export function hasFileDragData(e: React.DragEvent): boolean {
  return e.dataTransfer.types.includes(FILE_DRAG_MIME);
}

function quote(p: string): string {
  return /[\s'"]/.test(p) ? `'${p.replace(/'/g, "'\\''")}'` : p;
}

/** Build the text to paste into the terminal, trailing space included. */
export function fileDragToPaste(e: React.DragEvent): string | null {
  const raw = e.dataTransfer.getData(FILE_DRAG_MIME);
  if (!raw) return null;
  try {
    const items = JSON.parse(raw) as FileDragItem[];
    const parts = items
      .map((i) => (i.relPath ? `@${i.relPath}` : i.absPath ? quote(i.absPath) : null))
      .filter(Boolean);
    return parts.length ? `${parts.join(" ")} ` : null;
  } catch {
    return null;
  }
}
