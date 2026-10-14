import type { MicStatus } from "@exegol/shared";
import { app, type Session, session, shell, systemPreferences, type WebContents } from "electron";
import { pageClipboardDecision } from "../browser/page-events";
import { getMainWindow } from "../windows/main-window-ref";
import { allowMediaRequest } from "./media-policy";

const MAC_MIC_SETTINGS =
  "x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone";
/** getUserMedia follows the arm within a second; the macOS prompt is answered before it */
const ARM_MS = 10_000;

let armedUntil = 0;
/** Settings > Dictation > Input's Test: one getUserMedia from the window that pressed it */
let testArm: { webContentsId: number; until: number } | null = null;

/** macOS and Windows report the OS permission; Linux has none to ask for */
export function micStatus(): MicStatus {
  if (process.platform !== "darwin" && process.platform !== "win32") return "granted";
  try {
    return systemPreferences.getMediaAccessStatus("microphone") as MicStatus;
  } catch {
    return "unknown";
  }
}

/** A dictation is starting: macOS shows its prompt once (afterwards only System Settings can
 *  change the answer), then the main window may open the mic for a few seconds */
export async function askMic(): Promise<MicStatus> {
  if (process.platform === "darwin" && micStatus() === "not-determined") {
    await systemPreferences.askForMediaAccess("microphone");
  }
  armedUntil = Date.now() + ARM_MS;
  return micStatus();
}

/** The mic is open: no other getUserMedia rides on this start */
export function disarmMic(): void {
  armedUntil = 0;
}

/** The Test button: the macOS prompt if not asked yet, then only that window may open the mic,
 *  once, within a few seconds. Browser pages (webviews) cannot arm it */
export async function armMicTest(wc: WebContents): Promise<MicStatus> {
  if (wc.isDestroyed() || wc.getType() !== "window") return micStatus();
  if (process.platform === "darwin" && micStatus() === "not-determined") {
    await systemPreferences.askForMediaAccess("microphone");
  }
  testArm = { webContentsId: wc.id, until: Date.now() + ARM_MS };
  return micStatus();
}

export function openMicSettings(): void {
  if (process.platform === "darwin") void shell.openExternal(MAC_MIC_SETTINGS);
}

const appOrigin = (): string => {
  const dev = !app.isPackaged && process.env.ELECTRON_RENDERER_URL;
  if (!dev) return "file://";
  try {
    return new URL(dev).origin;
  } catch {
    return "file://";
  }
};

function decide(
  wc: WebContents | null,
  permission: string,
  mediaTypes: string[],
  url: string,
  check = false,
) {
  // One handler per session: browser pane pages' clipboard is decided here too
  const clipboard = pageClipboardDecision(wc, permission, url);
  if (clipboard !== null) return clipboard;
  const main = getMainWindow();
  const micTest =
    !!wc && !!testArm && testArm.webContentsId === wc.id && Date.now() < testArm.until;
  const allowed = allowMediaRequest({
    permission,
    mediaTypes,
    url,
    isMainWindow: !!wc && !!main && !main.isDestroyed() && wc === main.webContents,
    appOrigin: appOrigin(),
    armed: Date.now() < armedUntil,
    check,
    isAppWindow: !!wc && !wc.isDestroyed() && wc.getType() === "window",
    micTest,
  });
  if (allowed && micTest && !check) testArm = null;
  return allowed;
}

const guarded = new WeakSet<Session>();

function guardSession(ses: Session): void {
  if (guarded.has(ses)) return;
  guarded.add(ses);
  ses.setPermissionRequestHandler((wc, permission, callback, details) => {
    const media = "mediaTypes" in details ? (details.mediaTypes ?? []) : [];
    callback(decide(wc, permission, media, details.requestingUrl ?? wc.getURL()));
  });
  ses.setPermissionCheckHandler((wc, permission, origin, details) => {
    const media = details.mediaType ? [details.mediaType] : [];
    return decide(wc, permission, media, details.requestingUrl ?? origin, true);
  });
}

/** Mic and camera: every session (the default one and each project's browser partition) */
export function installMediaPermissions(): void {
  guardSession(session.defaultSession);
  app.on("session-created", guardSession);
}
