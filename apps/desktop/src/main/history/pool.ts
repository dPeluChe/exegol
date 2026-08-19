/**
 * Bounded-concurrency map. The stores hold hundreds of files (756 codex
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

/** Reads are I/O-bound with a small sync parse; past this the parses queue up. */
export const FILE_CONCURRENCY = 16;
