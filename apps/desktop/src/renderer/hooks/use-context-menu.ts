import { useCallback, useRef, useState } from "react";
import { useDismiss } from "./use-dismiss";

/** Right-click menu at the cursor; a mousedown outside it or Esc closes it */
export function useContextMenu<T extends HTMLElement = HTMLDivElement>() {
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  const menuRef = useRef<T>(null);

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ x: e.clientX, y: e.clientY });
  }, []);

  const closeContextMenu = useCallback(() => setContextMenu(null), []);

  useDismiss(menuRef, !!contextMenu, closeContextMenu);

  return { contextMenu, menuRef, handleContextMenu, closeContextMenu };
}
