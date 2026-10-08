import type { MicStatus } from "@exegol/shared";
import { app, type Session, session, shell, systemPreferences, type WebContents } from "electron";
import { getMainWindow } from "../windows/main-window-ref";
import { allowMediaRequest } from "./media-policy";

const MAC_MIC_SETTINGS =
  "x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone";
/** getUserMedia follows the arm within a second; the macOS prompt is answered before it */
const ARM_MS = 10_000;

let armedUntil = 0;

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

function decide(wc: WebContents | null, permission: string, mediaTypes: string[], url: string) {
  const main = getMainWindow();
  return allowMediaRequest({
    permission,
    mediaTypes,
    url,
    isMainWindow: !!wc && !!main && !main.isDestroyed() && wc === main.webContents,
    appOrigin: appOrigin(),
    armed: Date.now() < armedUntil,
  });
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
    return decide(wc, permission, media, details.requestingUrl ?? origin);
  });
}

/** Mic and camera: every session (the default one and each project's browser partition) */
export function installMediaPermissions(): void {
  guardSession(session.defaultSession);
  app.on("session-created", guardSession);
}
