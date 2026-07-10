import { isAbsolute } from "node:path";

/**
 * T155.6 — `exegol://` deep link parsing.
 *
 * Accepts `exegol://open?path=<url-encoded-abs-path>` fired by the `exegol`
 * CLI wrapper (resources/bin/exegol) via LaunchServices (macOS open-url) or
 * a second-instance argv (Windows/Linux). Pure function so the URL grammar
 * is unit-testable without Electron.
 */
export function parseDeepLink(url: string): { path: string } | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== "exegol:") return null;
  // `exegol://open?...` parses with host "open"; some encoders produce
  // `exegol:///open` (empty host, pathname "/open") — accept both.
  const action = parsed.host || parsed.pathname.replace(/^\/+/, "");
  if (action !== "open") return null;
  const path = parsed.searchParams.get("path");
  if (!path || !isAbsolute(path)) return null;
  return { path };
}

/** Find the deep-link URL in a second-instance argv, if any. */
export function findDeepLinkArg(argv: string[]): string | null {
  return argv.find((arg) => arg.startsWith("exegol://")) ?? null;
}
