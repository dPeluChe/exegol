/**
 * Bounded-concurrency map. The history stores hold hundreds of files (756 codex
 * rollouts here) and reading them one round-trip at a time made the scan as
 * slow as the file count — on the main process thread that also pumps PTY
 * output. Unbounded `Promise.all` would trade that for hundreds of open fds.
 */
export async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;

  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index] as T);
    }
  });

  await Promise.all(workers);
  return results;
}

/** Runs `fn` once fewer than `limit` calls are in flight, FIFO */
export function createLimiter(limit: number): <R>(fn: () => Promise<R>) => Promise<R> {
  let active = 0;
  const queue: (() => void)[] = [];
  return async (fn) => {
    // A finishing call hands its slot straight to the next waiter, so a newcomer can't jump in
    if (active >= limit) await new Promise<void>((resolve) => queue.push(resolve));
    else active++;
    try {
      return await fn();
    } finally {
      const next = queue.shift();
      if (next) next();
      else active--;
    }
  };
}

/** Every `*Async` napi call (walks, diffs, dirty checks) runs on the 4-thread libuv pool
 *  that fs I/O also needs: at most 2 at once, app-wide */
export const runNative = createLimiter(2);
