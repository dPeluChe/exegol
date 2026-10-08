import { randomBytes } from "node:crypto";
import { stat } from "node:fs/promises";
import { basename, join, relative, sep } from "node:path";
import { isPathInside, isSensitivePath, realpathSafe } from "../security/path-guard";

export const PREVIEW_SCHEME = "exegol-preview";

export const isPreviewUrl = (url: string | undefined): url is string =>
  !!url?.startsWith(`${PREVIEW_SCHEME}://`);

/** The token (host) of a preview URL, "" for anything else */
export function previewTokenOf(url: string | undefined): string {
  return isPreviewUrl(url) ? (url.slice(PREVIEW_SCHEME.length + 3).split(/[/?#]/)[0] ?? "") : "";
}

/** Only this scheme is reachable: a preview never phones home, scripts or not */
export function previewCsp(scripts: boolean): string {
  const s = `${PREVIEW_SCHEME}:`;
  return [
    "default-src 'none'",
    `script-src ${scripts ? `${s} 'unsafe-inline'` : "'none'"}`,
    `style-src ${s} 'unsafe-inline'`,
    `img-src ${s} data: blob:`,
    `font-src ${s} data:`,
    `media-src ${s} data: blob:`,
    `connect-src ${scripts ? s : "'none'"}`,
    `frame-src ${s}`,
    "worker-src 'none'",
    "object-src 'none'",
    "form-action 'none'",
    "base-uri 'none'",
  ].join("; ");
}

// ─── Grants: a token names one root (and whether scripts may run) ────────────

interface PreviewGrant {
  root: string;
  scripts: boolean;
}
const grants = new Map<string, PreviewGrant>();

export function grantPreview(root: string, scripts: boolean): string {
  for (const [token, g] of grants) {
    if (g.root === root && g.scripts === scripts) return token;
  }
  // Lowercase hex: a standard scheme lowercases its host
  const token = randomBytes(16).toString("hex");
  grants.set(token, { root, scripts });
  return token;
}

export function previewGrant(token: string): PreviewGrant | null {
  return grants.get(token) ?? null;
}

export function dropPreviewGrant(token: string): void {
  grants.delete(token);
}

/** The registered base (project or worktree) that holds `file`, most specific first */
export async function previewRootFor(file: string, bases: string[]): Promise<string | null> {
  const target = await realpathSafe(file);
  const roots = await Promise.all(bases.map(realpathSafe));
  const holding = roots.filter((r) => isPathInside(r, target));
  return holding.sort((a, b) => b.length - a.length)[0] ?? null;
}

/** A grant's root is served only while it is still one of the bases */
export async function isLiveRoot(root: string, bases: string[]): Promise<boolean> {
  const roots = await Promise.all(bases.map(realpathSafe));
  return roots.includes(root);
}

// ─── URL <-> file ────────────────────────────────────────────────────────────

/** Path segments of a preview URL, decoded; null when one does not decode */
export function segmentsFromUrlPath(pathname: string): string[] | null {
  try {
    return pathname.split("/").filter(Boolean).map(decodeURIComponent);
  } catch {
    return null;
  }
}

export function previewUrlFor(token: string, segments: string[]): string {
  return `${PREVIEW_SCHEME}://${token}/${segments.map(encodeURIComponent).join("/")}`;
}

export type PreviewRefusal = "bad-path" | "hidden" | "sensitive" | "outside-root" | "not-a-file";

export type PreviewResolution =
  | { ok: true; path: string }
  | { ok: false; reason: PreviewRefusal; name?: string };

export function refusalMessage(r: { reason: PreviewRefusal; name?: string }): string {
  switch (r.reason) {
    case "bad-path":
      return "Not a valid path inside the project";
    case "hidden":
      return `Hidden files and folders are never served (${r.name})`;
    case "sensitive":
      return `Credential and key files are never served (${r.name})`;
    case "outside-root":
      return "It leads outside the project (a symlink)";
    case "not-a-file":
      return "Not a file";
  }
}

const firstHidden = (segments: string[]) => segments.find((s) => s.startsWith("."));

/**
 * The file `segments` name under `root`, or why not. Refused: traversal, a symlink out of the
 * root, dotfiles and dot-folders (.env, .git), credential files, directories (no listing).
 */
export async function resolvePreviewFile(
  root: string,
  segments: string[],
): Promise<PreviewResolution> {
  const bad = (s: string) =>
    !s || s === "." || s === ".." || s.includes("/") || s.includes("\\") || s.includes("\0");
  if (segments.length === 0 || segments.some(bad)) return { ok: false, reason: "bad-path" };
  const hidden = firstHidden(segments);
  if (hidden) return { ok: false, reason: "hidden", name: hidden };
  const realRoot = await realpathSafe(root);
  const real = await realpathSafe(join(realRoot, ...segments));
  if (!isPathInside(realRoot, real) || real === realRoot) {
    return { ok: false, reason: "outside-root" };
  }
  // A symlink inside the root may still point at a dotfile or a key in it
  const hiddenTarget = firstHidden(relative(realRoot, real).split(sep));
  if (hiddenTarget) return { ok: false, reason: "hidden", name: hiddenTarget };
  if (isSensitivePath(real)) return { ok: false, reason: "sensitive", name: basename(real) };
  const info = await stat(real).catch(() => null);
  return info?.isFile() ? { ok: true, path: real } : { ok: false, reason: "not-a-file" };
}

// ─── Range requests (media seeking) ──────────────────────────────────────────

/** One `bytes=` range of a `size`-byte file: null = whole file, "unsatisfiable" = 416 */
export function parseRange(
  header: string | null,
  size: number,
): { start: number; end: number } | "unsatisfiable" | null {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m || (!m[1] && !m[2])) return null;
  let start: number;
  let end: number;
  if (!m[1]) {
    const suffix = Number(m[2]);
    if (suffix === 0) return "unsatisfiable";
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(m[1]);
    end = m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
  }
  if (start >= size || start > end) return "unsatisfiable";
  return { start, end };
}

// ─── Links a preview asked to open ───────────────────────────────────────────

/** What the link bar shows: the host, and the URL without its query and fragment */
export function linkNotice(raw: string): { url: string; host: string; dropped: boolean } | null {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return null;
  const dropped = !!u.search || !!u.hash;
  u.search = "";
  u.hash = "";
  return { url: u.toString(), host: u.host, dropped };
}

/** A click or Enter in the preview this recently counts as the user asking for the link */
export const GESTURE_WINDOW_MS = 1_000;

export function isRecentGesture(lastGestureAt: number | undefined, now: number): boolean {
  return (
    lastGestureAt !== undefined &&
    now - lastGestureAt >= 0 &&
    now - lastGestureAt <= GESTURE_WINDOW_MS
  );
}
