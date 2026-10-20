import { useState } from "react";
import { useMountEffect } from "../../hooks/use-mount-effect";

export const barBtn =
  "shrink-0 rounded border px-2 py-0.5 text-[10px] font-medium transition-colors hover:bg-white/10";

/** Requests shown one at a time in a pane's bar (page dialogs, site permissions). `subscribe`
 *  wires the push events and returns their cleanup */
export function usePaneQueue<T extends { id: string; paneId: string }>(
  paneId: string,
  subscribe: (add: (item: T) => void, remove: (id: string) => void) => () => void,
) {
  const [items, setItems] = useState<T[]>([]);
  const remove = (id: string) => setItems((list) => list.filter((i) => i.id !== id));
  // A pane keeps its id while mounted
  useMountEffect(() =>
    subscribe((item) => {
      if (item.paneId === paneId) setItems((list) => [...list, item]);
    }, remove),
  );
  return { first: items[0] ?? null, remove };
}
