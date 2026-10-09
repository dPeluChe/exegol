import { afterEach, describe, expect, it, vi } from "vitest";

const send = vi.fn();
const setTrayRecording = vi.fn();
let focused: object | null = null;
vi.mock("electron", () => ({ BrowserWindow: { getFocusedWindow: () => focused } }));
vi.mock("../system/tray", () => ({ setTrayRecording: (l: string | null) => setTrayRecording(l) }));
vi.mock("../lib/logger", () => ({ logger: { info: vi.fn() } }));
vi.mock("../windows/main-window-ref", () => ({ getMainWindow: () => ({ webContents: { send } }) }));

const { armDictationSession, disarmDictationSession, recordingLabel } = await import(
  "./background"
);

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
