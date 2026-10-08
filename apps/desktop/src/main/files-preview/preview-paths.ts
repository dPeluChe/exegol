import { randomBytes } from "node:crypto";
import { stat } from "node:fs/promises";
import { extname, join, relative, sep } from "node:path";
import { isPathInside, isSensitivePath, realpathSafe } from "../security/path-guard";

export const PREVIEW_SCHEME = "exegol-preview";

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".htm": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/plain; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".bmp": "image/bmp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".wasm": "application/wasm",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".ogg": "audio/ogg",
  ".pdf": "application/pdf",
};

export function previewMime(path: string): string {
  return MIME[extname(path).toLowerCase()] ?? "application/octet-stream";
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

/** A token names one project root (and whether scripts may run); the renderer never sends a root */
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

/** The registered base (project or worktree) that holds `file`, most specific first */
export async function previewRootFor(file: string, bases: string[]): Promise<string | null> {
  const target = await realpathSafe(file);
  const roots = await Promise.all(bases.map(realpathSafe));
  const holding = roots.filter((r) => isPathInside(r, target));
  return holding.sort((a, b) => b.length - a.length)[0] ?? null;
}

const hidden = (segments: string[]) => segments.some((s) => s.startsWith("."));

/**
 * The file a preview URL's path names under `root`, or null. Refused: traversal, a symlink out
 * of the root, dotfiles and dot-folders (.env, .git), credential files, directories.
 */
export async function resolvePreviewFile(root: string, urlPath: string): Promise<string | null> {
  let segments: string[];
  try {
    segments = urlPath.split("/").filter(Boolean).map(decodeURIComponent);
  } catch {
    return null;
  }
  if (segments.length === 0) return null;
  if (segments.some((s) => s === ".." || s.includes("\0") || s.includes("\\") || s.includes("/")))
    return null;
  if (hidden(segments)) return null;
  const realRoot = await realpathSafe(root);
  const real = await realpathSafe(join(realRoot, ...segments));
  if (!isPathInside(realRoot, real) || real === realRoot) return null;
  // A symlink inside the root may still point at a dotfile or a key in it
  if (hidden(relative(realRoot, real).split(sep)) || isSensitivePath(real)) return null;
  const info = await stat(real).catch(() => null);
  return info?.isFile() ? real : null;
}
