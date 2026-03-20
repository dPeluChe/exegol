const isDev = process.env.NODE_ENV !== "production";
let shuttingDown = false;

/** Mark logger as shutting down — silences write errors during app exit */
export function markShutdown(): void {
  shuttingDown = true;
}

function safePrint(fn: (...args: unknown[]) => void, ...args: unknown[]): void {
  if (shuttingDown) return;
  try {
    fn(...args);
  } catch {
    // Ignore EIO errors during shutdown
  }
}

export const logger = {
  info: (...args: unknown[]) => {
    if (isDev) safePrint(console.log, ...args);
  },
  warn: (...args: unknown[]) => safePrint(console.warn, ...args),
  error: (...args: unknown[]) => safePrint(console.error, ...args),
  debug: (...args: unknown[]) => {
    if (isDev) safePrint(console.log, "[DEBUG]", ...args);
  },
};
