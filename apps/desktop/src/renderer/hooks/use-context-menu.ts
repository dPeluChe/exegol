import { useCallback, useEffect, useRef, useState } from "react";

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

  useEffect(() => {
    if (!contextMenu) return;
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) closeContextMenu();
    };
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeContextMenu();
    };
    window.addEventListener("mousedown", handleClick);
    window.addEventListener("keydown", handleEsc);
    return () => {
      window.removeEventListener("mousedown", handleClick);
      window.removeEventListener("keydown", handleEsc);
    };
  }, [contextMenu, closeContextMenu]);

  return { contextMenu, menuRef, handleContextMenu, closeContextMenu };
}
