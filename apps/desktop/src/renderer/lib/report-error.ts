/**
 * T196: renderer errors only reached DevTools, which a packaged app never shows.
 * Forward them to main's log file so a bug report carries them.
 */
export function reportRendererError(source: string, error: unknown, extra?: string): void {
  const err = error instanceof Error ? error : new Error(String(error));
  try {
    window.api.reportError?.(source, err.message, [err.stack, extra].filter(Boolean).join("\n"));
  } catch {
    /* never let reporting throw */
  }
}

let installed = false;
export function installRendererErrorReporting(): void {
  if (installed) return;
  installed = true;
  window.addEventListener("error", (e) =>
    reportRendererError("window.error", e.error ?? e.message),
  );
  window.addEventListener("unhandledrejection", (e) =>
    reportRendererError("unhandledrejection", e.reason),
  );
}
