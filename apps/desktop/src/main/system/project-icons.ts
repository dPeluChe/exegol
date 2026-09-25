import { readFile, stat } from "node:fs/promises";
import { extname, join } from "node:path";
import { detectRunTargets } from "./scripts";

/** Where apps keep their icon, checked in the root and in each subrepo */
const CANDIDATES = [
  "favicon.ico",
  "favicon.png",
  "favicon.svg",
  "icon.png",
  "icon.svg",
  "logo.png",
  "logo.svg",
  "app/icon.png",
  "app/icon.svg",
  "app/favicon.ico",
  "app/apple-icon.png",
  "public/favicon.ico",
  "public/favicon.png",
  "public/favicon.svg",
  "public/icon.png",
  "public/logo.png",
  "public/logo.svg",
  "public/apple-touch-icon.png",
  "src/app/icon.png",
  "src/app/favicon.ico",
  "src/assets/icon.png",
  "src/assets/logo.png",
  "src-tauri/icons/128x128.png",
  "src-tauri/icons/icon.png",
  "assets/icon.png",
  "assets/logo.png",
  "build/icon.png",
  "resources/icon.png",
  "static/favicon.ico",
  "static/favicon.png",
];

const MIME: Record<string, string> = {
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
};
/** An icon; anything bigger is a photo or a sprite sheet */
const MAX_ICON_BYTES = 512 * 1024;

export function isIconFile(path: string): boolean {
  return extname(path).toLowerCase() in MIME;
}

/** The file as a data URL for an <img> (an SVG in <img> runs no script), or null */
export async function iconDataUrl(path: string): Promise<string | null> {
  const mime = MIME[extname(path).toLowerCase()];
  if (!mime) return null;
  try {
    const info = await stat(path);
    if (!info.isFile() || info.size > MAX_ICON_BYTES) return null;
    return `data:${mime};base64,${(await readFile(path)).toString("base64")}`;
  } catch {
    return null;
  }
}

/**
 * Icons found in the project: the root and every subrepo/package the launcher
 * lists (a workspace of repos keeps each app's icon inside its own folder).
 */
export async function detectProjectIcons(
  projectPath: string,
): Promise<{ path: string; rel: string; dataUrl: string }[]> {
  const folders = await detectRunTargets(projectPath);
  const found = await Promise.all(
    folders.flatMap((f) =>
      CANDIDATES.map(async (candidate) => {
        const path = join(f.path, candidate);
        const dataUrl = await iconDataUrl(path);
        return dataUrl ? { path, rel: f.rel ? `${f.rel}/${candidate}` : candidate, dataUrl } : null;
      }),
    ),
  );
  return found.filter((i): i is NonNullable<typeof i> => i !== null);
}
