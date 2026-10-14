/** Layout settles over a few frames on mount (toolbar, tabs); each size the PTY sees makes the CLI
 *  redraw, so only the last of a burst is sent */
export const RESIZE_STABLE_MS = 80;

type Grid = { cols: number; rows: number };

const same = (a: Grid | undefined, cols: number, rows: number) =>
  a !== undefined && a.cols === cols && a.rows === rows;

/**
 * One pending size per session; a newer request restarts the wait, and a size equal to the pending
 * or last sent one changes nothing (a 108 -> 102 -> 108 flap sends nothing). `owner` is the view
 * that asked: a view leaving (unmount, hidden) cancels only its own request
 */
export function createResizeStabilizer(
  send: (key: string, cols: number, rows: number) => void,
  delayMs = RESIZE_STABLE_MS,
) {
  const pending = new Map<string, Grid & { owner: object; timer: ReturnType<typeof setTimeout> }>();
  const sent = new Map<string, Grid>();

  const drop = (key: string) => {
    clearTimeout(pending.get(key)?.timer);
    pending.delete(key);
  };

  return {
    request(key: string, owner: object, cols: number, rows: number): void {
      const prev = pending.get(key);
      if (same(prev, cols, rows)) {
        if (prev) prev.owner = owner;
        return;
      }
      drop(key);
      if (same(sent.get(key), cols, rows)) return;
      const timer = setTimeout(() => {
        pending.delete(key);
        sent.set(key, { cols, rows });
        send(key, cols, rows);
      }, delayMs);
      pending.set(key, { cols, rows, owner, timer });
    },
    /** True when it dropped a size this view was settling */
    cancel(key: string, owner: object): boolean {
      if (pending.get(key)?.owner !== owner) return false;
      drop(key);
      return true;
    },
    /** The PTY's grid as main reports it (a mount's snapshot): another window may have moved it */
    noteSize(key: string, cols: number, rows: number): void {
      sent.set(key, { cols, rows });
    },
  };
}
