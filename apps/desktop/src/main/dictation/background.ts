import { BrowserWindow } from "electron";
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
  const tick = setInterval(() => {
    const focused = BrowserWindow.getFocusedWindow() !== null;
    setTrayRecording(focused ? null : recordingLabel(Date.now() - now));
  }, 1000);
  armed = { limit, tick };
}

export function disarmDictationSession(): void {
  if (!armed) return;
  clearTimeout(armed.limit);
  clearInterval(armed.tick);
  armed = null;
  setTrayRecording(null);
}
