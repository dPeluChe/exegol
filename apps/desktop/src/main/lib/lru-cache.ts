/**
 * LRU cache with in-flight Promise dedup.
 * Pattern lifted from Terax `src/modules/editor/lib/diffCache.ts:1-104`.
 * Used by the diff router so repeated reads of the same file/staged combo
 * don't hit git twice in the same UI render burst.
 */
export class AsyncLruCache<K, V> {
  private readonly cache = new Map<K, { value: V; at: number }>();
  private readonly inflight = new Map<K, Promise<V>>();

  /** @param ttlMs entries older than this are recomputed. Decided INSIDE
   *  getOrCompute so concurrent callers still share one in-flight promise —
   *  checking staleness at the call site and invalidating made every expiring
   *  caller wipe the others' in-flight scan and start its own. */
  constructor(
    private readonly maxSize: number,
    private readonly ttlMs?: number,
  ) {}

  async getOrCompute(key: K, factory: () => Promise<V>): Promise<V> {
    const hit = this.cache.get(key);
    if (hit && (this.ttlMs === undefined || Date.now() - hit.at < this.ttlMs)) {
      this.cache.delete(key);
      this.cache.set(key, hit);
      return hit.value;
    }
    if (hit) this.cache.delete(key);
    const pending = this.inflight.get(key);
    if (pending) return pending;
    const promise = (async () => {
      try {
        const value = await factory();
        this.cache.set(key, { value, at: Date.now() });
        if (this.cache.size > this.maxSize) {
          const oldest = this.cache.keys().next().value;
          if (oldest !== undefined) this.cache.delete(oldest);
        }
        return value;
      } finally {
        this.inflight.delete(key);
      }
    })();
    this.inflight.set(key, promise);
    return promise;
  }

  invalidateWhere(predicate: (key: K) => boolean): void {
    for (const k of this.cache.keys()) if (predicate(k)) this.cache.delete(k);
    for (const k of this.inflight.keys()) if (predicate(k)) this.inflight.delete(k);
  }

  clear(): void {
    this.cache.clear();
    this.inflight.clear();
  }
}
