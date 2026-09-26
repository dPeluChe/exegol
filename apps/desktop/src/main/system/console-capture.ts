import type { WebContents } from "electron";

const MAX_ENTRIES = 300;
const MAX_MESSAGE = 500;
const entries: string[] = [];

type Level = "debug" | "info" | "warning" | "error";
const LEVELS: Record<string | number, Level> = {
  0: "debug",
  1: "info",
  2: "warning",
  3: "error",
  debug: "debug",
  info: "info",
  warning: "warning",
  error: "error",
};

/** One DevTools console line, shaped like the app log so `compactLog` folds repeats */
export function recordConsole(
  window: string,
  level: Level,
  message: string,
  source?: string,
  line?: number,
): void {
  if (level === "debug") return;
  const where = source ? ` (${source.split("/").pop()}:${line ?? 0})` : "";
  const text = message.replace(/\s+/g, " ").slice(0, MAX_MESSAGE);
  entries.push(`${new Date().toISOString()} [${level.toUpperCase()}] [${window}] ${text}${where}`);
  if (entries.length > MAX_ENTRIES) entries.shift();
}

/**
 * The DevTools console of Exegol's own windows (main, settings, floating), for bug reports:
 * WebGL context loss and render warnings only show there. Browser-pane webviews are skipped,
 * their console belongs to whatever site the user opened.
 */
export function captureConsole(contents: WebContents): void {
  if (contents.getType() === "webview") return;
  // Electron 41 passes one details object; older builds passed positional args
  contents.on("console-message", (...args: unknown[]) => {
    const [first, level, message, line, source] = args as [
      { level?: string; message?: string; lineNumber?: number; sourceId?: string },
      number,
      string,
      number,
      string,
    ];
    const url = contents.getURL();
    const window = url.includes("settings=1")
      ? "settings"
      : url.includes("floatingPane=")
        ? "floating"
        : "main";
    if (typeof first?.message === "string") {
      recordConsole(
        window,
        LEVELS[first.level ?? "info"] ?? "info",
        first.message,
        first.sourceId,
        first.lineNumber,
      );
    } else {
      recordConsole(window, LEVELS[level] ?? "info", String(message ?? ""), source, line);
    }
  });
}

export function consoleTail(): string {
  return entries.join("\n");
}
