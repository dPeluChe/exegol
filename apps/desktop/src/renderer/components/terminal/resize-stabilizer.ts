/** A box must hold its size this long before the PTY hears it: layout settles over several frames
 *  on a mount or a project switch, and every size the PTY sees makes the CLI redraw */
export const RESIZE_STABLE_MS = 150;

interface Timers {
  set: (fn: () => void, ms: number) => unknown;
  clear: (handle: unknown) => void;
}

const realTimers: Timers = {
  set: (fn, ms) => setTimeout(fn, ms),
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

/**
 * One pending size per session; a newer request restarts the wait. `owner` is the view that asked:
 * a view leaving (unmount, hidden) cancels only its own request, never another view's
 */
export function createResizeStabilizer(
  send: (key: string, cols: number, rows: number) => void,
  delayMs = RESIZE_STABLE_MS,
  timers: Timers = realTimers,
) {
  const pending = new Map<string, { owner: object; handle: unknown }>();
  return {
    request(key: string, owner: object, cols: number, rows: number): void {
      const prev = pending.get(key);
      if (prev) timers.clear(prev.handle);
      const handle = timers.set(() => {
        pending.delete(key);
        send(key, cols, rows);
      }, delayMs);
      pending.set(key, { owner, handle });
    },
    cancel(key: string, owner: object): void {
      const prev = pending.get(key);
      if (!prev || prev.owner !== owner) return;
      timers.clear(prev.handle);
      pending.delete(key);
    },
    has(key: string): boolean {
      return pending.has(key);
    },
  };
}
