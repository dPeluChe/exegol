const MAX_KEYS = 1_000;

/** Per-key log rate limit that counts what it held back, so a line can say `(+N suppressed)` */
export function createLogLimiter(everyMs: number, maxKeys = MAX_KEYS) {
  const state = new Map<string, { at: number; suppressed: number }>();

  // Keys are session ids and methods: bounded in practice, capped in case a caller leaks them
  const makeRoom = (now: number) => {
    for (const [key, entry] of state) if (now - entry.at >= everyMs) state.delete(key);
    while (state.size >= maxKeys) {
      const oldest = state.keys().next().value;
      if (oldest === undefined) break;
      state.delete(oldest);
    }
  };

  return {
    /** null: skip this line. A number: log it, with that many skipped since the last one */
    take(key: string, now: number, force = false): number | null {
      const entry = state.get(key);
      if (entry && !force && now - entry.at < everyMs) {
        entry.suppressed++;
        return null;
      }
      if (!entry && state.size >= maxKeys) makeRoom(now);
      state.set(key, { at: now, suppressed: 0 });
      return entry?.suppressed ?? 0;
    },
    forget(key: string): void {
      state.delete(key);
    },
    reset(): void {
      state.clear();
    },
    get size(): number {
      return state.size;
    },
  };
}

export type LogLimiter = ReturnType<typeof createLogLimiter>;

export function suppressedNote(n: number): string {
  return n > 0 ? ` (+${n} suppressed)` : "";
}
