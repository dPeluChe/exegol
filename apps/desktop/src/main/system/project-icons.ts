import { readFile, stat } from "node:fs/promises";
import { extname, join } from "node:path";
import type Database from "libsql";
import { getJsonSetting, setJsonSetting } from "../db/queries/settings";
import { broadcast } from "../lib/event-bus";
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
  // Electron (electron-builder buildResources)
  "build/icons/icon.png",
  "build/icons/512x512.png",
  "resources/build/icons/icon.png",
  "src/resources/icon.png",
  "src/resources/build/icons/icon.png",
  // Expo / React Native, Android, Flutter, Tauri
  "assets/images/icon.png",
  "assets/images/adaptive-icon.png",
  "assets/adaptive-icon.png",
  "android/app/src/main/res/mipmap-xxxhdpi/ic_launcher.png",
  "web/icons/Icon-512.png",
  "web/favicon.png",
  "src-tauri/icons/128x128@2x.png",
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

/**
 * Stores the first icon found as the project's image, once: at creation, and a single backfill for
 * projects added before this existed. A project whose icon the user set, or reset on purpose after
 * the backfill, is never touched again; the dialog still scans to offer the others.
 */
export async function adoptDetectedIcon(
  db: Database.Database,
  projectId: string,
): Promise<boolean> {
  const row = db
    .prepare("SELECT path, icon, icon_image FROM projects WHERE id = ?")
    .get(projectId) as { path: string; icon: string | null; icon_image: string | null } | undefined;
  if (!row || row.icon || row.icon_image) return false;
  const [first] = await detectProjectIcons(row.path);
  if (!first) return false;
  db.prepare(
    "UPDATE projects SET icon_image = ? WHERE id = ? AND icon IS NULL AND icon_image IS NULL",
  ).run(first.path, projectId);
  return true;
}

const BACKFILL_KEY = "projectIconsBackfilled";

export async function backfillProjectIcons(db: Database.Database): Promise<void> {
  if (getJsonSetting(db, BACKFILL_KEY, false)) return;
  const ids = db.prepare("SELECT id FROM projects").all() as { id: string }[];
  let adopted = 0;
  for (const { id } of ids) if (await adoptDetectedIcon(db, id).catch(() => false)) adopted++;
  setJsonSetting(db, BACKFILL_KEY, true);
  // The windows loaded the project list before this ran: have them refetch it
  if (adopted > 0) broadcast("settings:changed");
}
