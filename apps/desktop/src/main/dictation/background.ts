import { BrowserWindow } from "electron";
import { execFileAsync } from "../lib/exec-file";
import { logger } from "../lib/logger";
import { setTrayRecording } from "../system/tray";
import { getMainWindow } from "../windows/main-window-ref";

/** The tray label while a dictation records out of sight */
export function recordingLabel(elapsedMs: number): string {
  const secs = Math.max(0, Math.floor(elapsedMs / 1000));
  return `● REC ${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`;
}

interface Armed {
  limit: ReturnType<typeof setTimeout>;
  tick: ReturnType<typeof setInterval>;
}

let armed: Armed | null = null;

/** Main owns the longest-dictation limit: a renderer timer is throttled while Exegol is in the
 *  background, which is exactly when a recording now keeps going */
export function armDictationSession(sessionId: string, maxSeconds: number, now = Date.now()): void {
  disarmDictationSession();
  const limit = setTimeout(() => {
    getMainWindow()?.webContents.send("dictation:key", { kind: "limit", sessionId, maxSeconds });
  }, maxSeconds * 1000);
  let wasFocused = true;
  const tick = setInterval(() => {
    const focused = BrowserWindow.getFocusedWindow() !== null;
    setTrayRecording(focused ? null : recordingLabel(Date.now() - now));
    if (focused !== wasFocused) logFocus(focused, Date.now() - now);
    wasFocused = focused;
  }, 1000);
  armed = { limit, tick };
}

// An Esc that never reached any Exegol window was reported live: say where the focus went
function logFocus(focused: boolean, elapsedMs: number): void {
  const at = `${Math.round(elapsedMs / 1000)}s`;
  if (focused) {
    logger.info(`[Dictation] Exegol has the focus again at ${at}`);
    return;
  }
  void frontApp().then((app) =>
    logger.info(`[Dictation] Exegol lost the focus at ${at} while recording (front: ${app})`),
  );
}

async function frontApp(): Promise<string> {
  if (process.platform !== "darwin") return "unknown";
  try {
    const { stdout: asn } = await execFileAsync("lsappinfo", ["front"]);
    const { stdout } = await execFileAsync("lsappinfo", ["info", "-only", "name", asn.trim()]);
    return stdout.match(/"LSDisplayName"="([^"]*)"/)?.[1] ?? "unknown";
  } catch {
    return "unknown";
  }
}

export function disarmDictationSession(): void {
  if (!armed) return;
  clearTimeout(armed.limit);
  clearInterval(armed.tick);
  armed = null;
  setTrayRecording(null);
}
