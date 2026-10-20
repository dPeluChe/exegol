/** Callers waiting for a session's cleanup (exit), each with its own timeout fallback */
export class ExitWaiters {
  private readonly waiters = new Map<string, Array<() => void>>();

  wait(id: string, timeoutMs: number): Promise<void> {
    return new Promise((resolve) => {
      const waiter = () => {
        clearTimeout(timer);
        resolve();
      };
      const timer = setTimeout(() => {
        const list = this.waiters.get(id);
        if (list) {
          const idx = list.indexOf(waiter);
          if (idx !== -1) list.splice(idx, 1);
          if (list.length === 0) this.waiters.delete(id);
        }
        resolve();
      }, timeoutMs);
      const list = this.waiters.get(id) ?? [];
      list.push(waiter);
      this.waiters.set(id, list);
    });
  }

  notify(id: string): void {
    const list = this.waiters.get(id);
    if (!list) return;
    this.waiters.delete(id);
    for (const w of list) w();
  }

  notifyAll(): void {
    for (const id of [...this.waiters.keys()]) this.notify(id);
  }
}
