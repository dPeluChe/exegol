/** Requests of browser pane pages waiting on a bar in the pane (dialogs, site permissions).
 *  No Electron here */

export const MAX_PENDING_PER_PAGE = 3;

export interface PendingItem {
  id: string;
  wcId: number;
  /** Takes the bar away (it went without an answer from it) */
  notifyClosed: () => void;
}

export function createPendingStore<T extends PendingItem>() {
  const items = new Map<string, T>();
  return {
    add(item: T): void {
      items.set(item.id, item);
    },
    get: (id: string): T | undefined => items.get(id),
    /** Removes it; undefined when it is already gone */
    take(id: string): T | undefined {
      const item = items.get(id);
      items.delete(id);
      return item;
    },
    find(match: (item: T) => boolean): T | undefined {
      for (const item of items.values()) if (match(item)) return item;
      return undefined;
    },
    of: (wcId: number): T[] => [...items.values()].filter((i) => i.wcId === wcId),
    countOf(wcId: number): number {
      let n = 0;
      for (const i of items.values()) if (i.wcId === wcId) n += 1;
      return n;
    },
    /** Removes every item of the page, unanswered */
    dropOf(wcId: number): T[] {
      const out = [...items.values()].filter((i) => i.wcId === wcId);
      for (const i of out) items.delete(i.id);
      return out;
    },
  };
}
