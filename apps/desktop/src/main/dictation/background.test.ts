import { afterEach, describe, expect, it, vi } from "vitest";

const send = vi.fn();
const setTrayRecording = vi.fn();
let focused: object | null = null;

import type { RecordingClock } from "./background";

vi.mock("electron", () => ({ BrowserWindow: { getFocusedWindow: () => focused } }));
vi.mock("../system/tray", () => ({ setTrayRecording: (l: string | null) => setTrayRecording(l) }));
vi.mock("../lib/logger", () => ({ logger: { info: vi.fn() } }));
vi.mock("../windows/main-window-ref", () => ({ getMainWindow: () => ({ webContents: { send } }) }));

const {
  armDictationSession,
  clockElapsed,
  disarmDictationSession,
  pauseClock,
  pauseDictationSession,
  recordingLabel,
  resumeClock,
} = await import("./background");

afterEach(() => {
  disarmDictationSession();
  vi.useRealTimers();
  send.mockClear();
  setTrayRecording.mockClear();
});

describe("recordingLabel", () => {
  it("shows minutes and seconds of the recording", () => {
    expect(recordingLabel(0)).toBe("● REC 0:00");
    expect(recordingLabel(42_900)).toBe("● REC 0:42");
    expect(recordingLabel(5 * 60_000 + 7_000)).toBe("● REC 5:07");
    expect(recordingLabel(-5)).toBe("● REC 0:00");
    expect(recordingLabel(42_900, true)).toBe("❚❚ REC 0:42 paused");
  });
});

describe("recording clock", () => {
  it("stops counting while paused and goes on from there", () => {
    let c: RecordingClock = { before: 0, runningSince: 1_000 };
    expect(clockElapsed(c, 4_000)).toBe(3_000);
    c = pauseClock(c, 4_000);
    expect(clockElapsed(c, 60_000)).toBe(3_000);
    expect(pauseClock(c, 70_000)).toBe(c);
    c = resumeClock(c, 60_000);
    expect(clockElapsed(c, 62_000)).toBe(5_000);
    expect(resumeClock(c, 63_000)).toBe(c);
  });
});

describe("armDictationSession", () => {
  it("main pushes the stop at the longest-dictation limit", () => {
    vi.useFakeTimers();
    armDictationSession("s1", 60);
    vi.advanceTimersByTime(59_999);
    expect(send).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(send).toHaveBeenCalledWith("dictation:key", {
      kind: "limit",
      sessionId: "s1",
      maxSeconds: 60,
    });
  });

  it("a pause holds the limit back by its length", () => {
    vi.useFakeTimers();
    armDictationSession("s1", 60, Date.now());
    vi.advanceTimersByTime(20_000);
    expect(pauseDictationSession(true)).toBe(40_000);
    vi.advanceTimersByTime(600_000);
    expect(send).not.toHaveBeenCalled();
    expect(pauseDictationSession(false)).toBe(40_000);
    vi.advanceTimersByTime(39_999);
    expect(send).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("shows REC in the tray only while no Exegol window has the focus, and clears it", () => {
    vi.useFakeTimers();
    focused = null;
    armDictationSession("s1", 600, Date.now());
    vi.advanceTimersByTime(3_000);
    expect(setTrayRecording).toHaveBeenLastCalledWith("● REC 0:03");
    focused = {};
    vi.advanceTimersByTime(1_000);
    expect(setTrayRecording).toHaveBeenLastCalledWith(null);
    disarmDictationSession();
    vi.advanceTimersByTime(600_000);
    expect(send).not.toHaveBeenCalled();
  });
});
