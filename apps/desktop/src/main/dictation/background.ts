import { BrowserWindow } from "electron";
import { execFileAsync } from "../lib/exec-file";
import { logger } from "../lib/logger";
import { setTrayRecording } from "../system/tray";
import { getMainWindow } from "../windows/main-window-ref";

/** The tray label while a dictation records out of sight */
export function recordingLabel(elapsedMs: number, paused = false): string {
  const secs = Math.max(0, Math.floor(elapsedMs / 1000));
  const time = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`;
  return paused ? `❚❚ REC ${time} paused` : `● REC ${time}`;
}

/** Recorded time: what ran before the last pause plus the running stretch, if any */
export interface RecordingClock {
  before: number;
  runningSince: number | null;
}

export const clockElapsed = (c: RecordingClock, now: number): number =>
  c.before + (c.runningSince === null ? 0 : now - c.runningSince);

export function pauseClock(c: RecordingClock, now: number): RecordingClock {
  return c.runningSince === null ? c : { before: clockElapsed(c, now), runningSince: null };
}

export function resumeClock(c: RecordingClock, now: number): RecordingClock {
  return c.runningSince === null ? { ...c, runningSince: now } : c;
}

interface Armed {
  sessionId: string;
  maxSeconds: number;
  clock: RecordingClock;
  limit: ReturnType<typeof setTimeout> | null;
  tick: ReturnType<typeof setInterval>;
}

let armed: Armed | null = null;

function armLimit(a: Armed, now: number): void {
  const { sessionId, maxSeconds } = a;
  a.limit = setTimeout(
    () => {
      getMainWindow()?.webContents.send("dictation:key", { kind: "limit", sessionId, maxSeconds });
    },
    Math.max(0, maxSeconds * 1000 - clockElapsed(a.clock, now)),
  );
}

/** Main owns the longest-dictation limit: a renderer timer is throttled while Exegol is in the
 *  background, which is exactly when a recording now keeps going */
export function armDictationSession(sessionId: string, maxSeconds: number, now = Date.now()): void {
  disarmDictationSession();
  let wasFocused = true;
  const tick = setInterval(() => {
    if (!armed) return;
    const focused = BrowserWindow.getFocusedWindow() !== null;
    const elapsed = clockElapsed(armed.clock, Date.now());
    setTrayRecording(focused ? null : recordingLabel(elapsed, armed.clock.runningSince === null));
    if (focused !== wasFocused) logFocus(focused, elapsed);
    wasFocused = focused;
  }, 1000);
  armed = { sessionId, maxSeconds, clock: { before: 0, runningSince: now }, limit: null, tick };
  armLimit(armed, now);
}

/** A paused dictation does not count toward the limit; the tray shows it paused */
export function pauseDictationSession(paused: boolean, now = Date.now()): number {
  if (!armed) return 0;
  if (paused) {
    armed.clock = pauseClock(armed.clock, now);
    if (armed.limit) clearTimeout(armed.limit);
    armed.limit = null;
  } else if (armed.clock.runningSince === null) {
    armed.clock = resumeClock(armed.clock, now);
    armLimit(armed, now);
  }
  return Math.max(0, armed.maxSeconds * 1000 - clockElapsed(armed.clock, now));
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
  if (armed.limit) clearTimeout(armed.limit);
  clearInterval(armed.tick);
  armed = null;
  setTrayRecording(null);
}
