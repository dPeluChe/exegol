import type { Terminal } from "@xterm/xterm";
import { type RefObject, useCallback, useState } from "react";
import { fileDragToPaste, hasFileDragData } from "../../lib/file-drag";

/** T155: drop a file (from FileExplorer/GitPane) → paste as @path mention */
export function useTerminalFileDrop(readOnly: boolean, terminalRef: RefObject<Terminal | null>) {
  const [isDragOver, setIsDragOver] = useState(false);

  const handleDragOver = useCallback(
    (e: React.DragEvent) => {
      if (readOnly || !hasFileDragData(e)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
      setIsDragOver(true);
    },
    [readOnly],
  );
  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      setIsDragOver(false);
      if (readOnly) return;
      const text = fileDragToPaste(e);
      if (!text) return;
      e.preventDefault();
      terminalRef.current?.paste(text);
      terminalRef.current?.focus();
    },
    [readOnly, terminalRef],
  );
  const handleDragLeave = useCallback(() => setIsDragOver(false), []);

  return { isDragOver, handleDragOver, handleDragLeave, handleDrop };
}
