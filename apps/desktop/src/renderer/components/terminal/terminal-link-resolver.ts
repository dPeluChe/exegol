export type FetchResolved = (
  texts: string[],
  cwd: string | undefined,
) => Promise<Array<{ text: string; path: string | null }>>;

const FOUND_TTL_MS = 5 * 60_000;
/** Short: an agent prints a path, then creates the file */
const MISSING_TTL_MS = 10_000;
const MAX_BATCH = 300;
const MAX_ENTRIES = 5_000;

/**
 * Which printed paths are real files, asked of main once per viewport: the first hovered row
 * sends every unknown candidate on screen in one call, the other rows wait on it or hit the
 * cache. A cwd change (a shell `cd`) drops what was learned.
 */
export class LinkPathResolver {
  private cache = new Map<string, { path: string | null; at: number }>();
  private inflight = new Map<string, Promise<void>>();
  private cwd: string | undefined;
  private generation = 0;

  constructor(
    private readonly fetch: FetchResolved,
    private readonly now: () => number = Date.now,
  ) {}

  private known(text: string): boolean {
    const hit = this.cache.get(text);
    if (!hit) return false;
    return this.now() - hit.at < (hit.path ? FOUND_TTL_MS : MISSING_TTL_MS);
  }

  async resolve(
    texts: string[],
    cwd: string | undefined,
    viewport: () => string[],
  ): Promise<Map<string, string | null>> {
    if (cwd !== this.cwd) {
      this.cwd = cwd;
      this.generation++;
      this.cache.clear();
      this.inflight.clear();
    }
    const unknown = (t: string) => !this.known(t) && !this.inflight.has(t);
    const missing = texts.filter(unknown);
    if (missing.length) {
      const batch = [...new Set([...missing, ...viewport().filter(unknown)])].slice(0, MAX_BATCH);
      const generation = this.generation;
      const request = this.fetch(batch, cwd)
        .then((rows) => {
          if (generation !== this.generation) return;
          if (this.cache.size > MAX_ENTRIES) this.cache.clear();
          const at = this.now();
          for (const row of rows) this.cache.set(row.text, { path: row.path, at });
        })
        .catch(() => {})
        .finally(() => {
          for (const t of batch) if (this.inflight.get(t) === request) this.inflight.delete(t);
        });
      for (const t of batch) this.inflight.set(t, request);
    }
    await Promise.all(texts.map((t) => this.inflight.get(t)));
    return new Map(texts.map((t) => [t, this.cache.get(t)?.path ?? null]));
  }
}
