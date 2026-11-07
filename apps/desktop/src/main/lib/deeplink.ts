import { isAbsolute } from "node:path";
import type { CaptureLink } from "@exegol/shared";

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

const CAPTURE_TEXT_MAX = 8_000;

/** `exegol://capture?url=&title=&text=`: any page can fire it, so it only fills a dialog the person confirms */
export function parseCaptureLink(link: string): CaptureLink | null {
  let parsed: URL;
  try {
    parsed = new URL(link);
  } catch {
    return null;
  }
  if (parsed.protocol !== "exegol:") return null;
  if ((parsed.host || parsed.pathname.replace(/^\/+/, "")) !== "capture") return null;
  const field = (name: string, max: number) =>
    parsed.searchParams.get(name)?.trim().slice(0, max) || null;
  const raw = field("url", 2_000);
  const url = raw && /^https?:\/\//i.test(raw) ? raw : null;
  const capture = { title: field("title", 120), url, text: field("text", CAPTURE_TEXT_MAX) };
  return capture.url || capture.text ? capture : null;
}

/** Find the deep-link URL in a second-instance argv, if any. */
export function findDeepLinkArg(argv: string[]): string | null {
  return argv.find((arg) => arg.startsWith("exegol://")) ?? null;
}
