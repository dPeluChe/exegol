import { execFile } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { logger } from "../lib/logger";

const DESKTOP_ID = "exegol-appimage.desktop";

/** Exec value per the desktop entry spec: quoted, with " ` $ \ escaped */
const quoteExec = (path: string) => `"${path.replace(/(["`$\\])/g, "\\$1")}"`;

/** The menu entry for an AppImage at `appImage`, with the icon at `icon` */
export function appImageDesktopEntry(appImage: string, icon: string): string {
  return [
    "[Desktop Entry]",
    "Type=Application",
    "Name=Exegol",
    "Comment=Run AI coding agents side by side",
    `Exec=${quoteExec(appImage)} %U`,
    `Icon=${icon}`,
    "Terminal=false",
    "Categories=Development;",
    "StartupWMClass=Exegol",
    "MimeType=x-scheme-handler/exegol;",
    "",
  ].join("\n");
}

/**
 * An AppImage is just a file: closed, it was in no menu and on no PATH, so it could not be found
 * again (reported on Fedora). On every launch from an AppImage, write a user menu entry pointing
 * at it (refreshed when the file moves or updates) and register it for exegol:// links, which the
 * `exegol` CLI opener uses. The .deb installs its own entry; this runs only for the AppImage
 */
export function integrateAppImage(): void {
  const appImage = process.env.APPIMAGE;
  if (process.platform !== "linux" || !appImage) return;
  try {
    const data = process.env.XDG_DATA_HOME || join(homedir(), ".local", "share");
    const iconDir = join(data, "exegol");
    const icon = join(iconDir, "exegol.png");
    mkdirSync(iconDir, { recursive: true });
    if (!existsSync(icon)) copyFileSync(join(process.resourcesPath, "tray-icon.png"), icon);

    const appsDir = join(data, "applications");
    const file = join(appsDir, DESKTOP_ID);
    const entry = appImageDesktopEntry(appImage, icon);
    const current = existsSync(file) ? readFileSync(file, "utf8") : null;
    if (current === entry) return;
    mkdirSync(appsDir, { recursive: true });
    writeFileSync(file, entry);
    logger.info("[AppImage] Menu entry written");
    // Best effort: menus pick the file up anyway; these make it immediate and own exegol://
    execFile("update-desktop-database", [appsDir], () => {});
    execFile("xdg-mime", ["default", DESKTOP_ID, "x-scheme-handler/exegol"], () => {});
  } catch (err) {
    logger.warn("[AppImage] Menu entry not written:", err);
  }
}
