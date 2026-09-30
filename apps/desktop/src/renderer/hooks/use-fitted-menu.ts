import { type RefObject, useLayoutEffect, useState } from "react";
import { fitMenuToViewport } from "../lib/fit-menu";

/**
 * Position style for a fixed menu opened at a point: measured before paint, so it never shows
 * cut off below or right of the window (a right-click near the bottom opened it off screen).
 */
export function useFittedMenu(
  menuRef: RefObject<HTMLElement | null>,
  point: { x: number; y: number } | null,
): React.CSSProperties {
  const [style, setStyle] = useState<React.CSSProperties>({});
  const x = point?.x;
  const y = point?.y;
  useLayoutEffect(() => {
    const el = menuRef.current;
    if (x === undefined || y === undefined || !el) return;
    const { left, top, maxHeight } = fitMenuToViewport(
      { x, y },
      { width: el.offsetWidth, height: el.scrollHeight },
      { width: window.innerWidth, height: window.innerHeight },
    );
    setStyle({ left, top, maxHeight, overflowY: "auto" });
  }, [menuRef, x, y]);
  // First render at the cursor, measured and moved before the browser paints it
  return x === undefined || y === undefined ? {} : { left: x, top: y, ...style };
}
