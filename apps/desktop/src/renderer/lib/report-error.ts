/**
 * T196: renderer errors only reached DevTools, which a packaged app never shows.
 * Forward them to main's log file so a bug report carries them.
 */
// A render loop can throw the same error every frame: keep the log useful
const MAX_REPORTS = 50;
const REPEAT_WINDOW_MS = 5_000;
let reports = 0;
let last = { message: "", at: 0 };

export function reportRendererError(source: string, error: unknown, extra?: string): void {
  const err = error instanceof Error ? error : new Error(String(error));
  const now = Date.now();
  if (reports >= MAX_REPORTS) return;
  if (err.message === last.message && now - last.at < REPEAT_WINDOW_MS) return;
  last = { message: err.message, at: now };
  reports++;
  try {
    window.api.reportError?.(source, err.message, [err.stack, extra].filter(Boolean).join("\n"));
  } catch {
    /* never let reporting throw */
  }
}

export function installRendererErrorReporting(): void {
  window.addEventListener("error", (e) =>
    reportRendererError("window.error", e.error ?? e.message),
  );
  window.addEventListener("unhandledrejection", (e) =>
    reportRendererError("unhandledrejection", e.reason),
  );
}
