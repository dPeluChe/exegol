/**
 * LRU cache with in-flight Promise dedup.
 * Pattern lifted from Terax `src/modules/editor/lib/diffCache.ts:1-104`.
 * Used by the diff router so repeated reads of the same file/staged combo
 * don't hit git twice in the same UI render burst.
 */
export class AsyncLruCache<K, V> {
  private readonly cache = new Map<K, V>();
  private readonly inflight = new Map<K, Promise<V>>();

  constructor(private readonly maxSize: number) {}

  async getOrCompute(key: K, factory: () => Promise<V>): Promise<V> {
    if (this.cache.has(key)) {
      const value = this.cache.get(key) as V;
      this.cache.delete(key);
      this.cache.set(key, value);
      return value;
    }
    const pending = this.inflight.get(key);
    if (pending) return pending;
    const promise = (async () => {
      try {
        const value = await factory();
        this.cache.set(key, value);
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
