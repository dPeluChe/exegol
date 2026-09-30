import { useState } from "react";
import { endGesture, moveGesture, startGesture } from "../lib/pointer-reorder";
import { useLatest } from "./use-latest";

const swallowClick = (e: MouseEvent) => {
  e.preventDefault();
  e.stopPropagation();
};

/**
 * Drag to reorder with pointer events. The sidebar's native HTML drag and drop never reordered
 * (it needs the OS drag session); pointer events always arrive. Press anywhere on an item and
 * move past a few pixels: a plain click still does what it did.
 */
export function usePointerReorder(onReorder: (drag: string, target: string) => void) {
  const [state, setState] = useState<{ dragging: string | null; over: string | null }>({
    dragging: null,
    over: null,
  });
  const onReorderRef = useLatest(onReorder);

  const itemProps = (key: string) => ({
    "data-reorder-key": key,
    onPointerDown: (e: React.PointerEvent) => {
      if (e.button !== 0) return;
      let gesture = startGesture(key, e.clientX, e.clientY);
      const keyAt = (x: number, y: number) =>
        document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-reorder-key]")?.dataset
          .reorderKey ?? null;
      const move = (ev: PointerEvent) => {
        gesture = moveGesture(gesture, ev.clientX, ev.clientY, keyAt(ev.clientX, ev.clientY));
        if (gesture.active) setState({ dragging: gesture.key, over: gesture.over });
      };
      const end = () => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", end);
        window.removeEventListener("pointercancel", end);
        const { drop, wasDrag } = endGesture(gesture);
        if (wasDrag) {
          // The click that ends a drag must not also navigate
          window.addEventListener("click", swallowClick, { capture: true, once: true });
          setTimeout(() => window.removeEventListener("click", swallowClick, true), 0);
        }
        setState({ dragging: null, over: null });
        if (drop) onReorderRef.current(drop.drag, drop.target);
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", end);
      window.addEventListener("pointercancel", end);
    },
  });

  return { itemProps, draggingKey: state.dragging, overKey: state.over };
}
