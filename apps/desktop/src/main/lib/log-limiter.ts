/** Per-key log rate limit that counts what it held back, so a line can say `(+N suppressed)` */
export function createLogLimiter(everyMs: number) {
  const state = new Map<string, { at: number; suppressed: number }>();
  return {
    /** null: skip this line. A number: log it, with that many skipped since the last one */
    take(key: string, now: number, force = false): number | null {
      const entry = state.get(key);
      if (entry && !force && now - entry.at < everyMs) {
        entry.suppressed++;
        return null;
      }
      const suppressed = entry?.suppressed ?? 0;
      state.set(key, { at: now, suppressed: 0 });
      return suppressed;
    },
    forget(key: string): void {
      state.delete(key);
    },
  };
}

export function suppressedNote(n: number): string {
  return n > 0 ? ` (+${n} suppressed)` : "";
}
