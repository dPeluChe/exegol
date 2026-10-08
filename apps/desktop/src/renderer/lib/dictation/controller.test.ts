import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const trpcMutate = vi.fn(async (path: string, _input?: unknown): Promise<unknown> => {
  if (path === "dictation.requestMic") return { mic: "granted" };
  if (path === "dictation.start") return { sessionId: "s1" };
  return {};
});
vi.mock("../trpc-client", () => ({
  trpcInvoke: vi.fn(async () => ({ dictation: { enabled: true, autoStopSilenceSec: 0 } })),
  trpcMutate: (path: string, input?: unknown) => trpcMutate(path, input),
}));
vi.mock("../../hooks/use-trpc-dictation", () => ({
  DICTATION_STATUS_KEY: ["dictation", "status"],
  fetchDictationStatus: async () => ({ engineAvailable: true, model: { ready: true } }),
}));

let feed: (samples: Float32Array) => void = () => {};
let openMic: () => void = () => {};
const stopCapture = vi.fn();
vi.mock("./capture", () => ({
  startCapture: (onChunk: (samples: Float32Array) => void) => {
    feed = onChunk;
    return new Promise((resolve) => {
      openMic = () => resolve({ stop: stopCapture, analyser: null });
    });
  },
}));

const { appFocusChanged, chordDown, chordUp, dismissDictation } = await import("./controller");
const { useDictationStore } = await import("../../stores/dictation");
const { useToastStore } = await import("../../stores/toasts");

const writeText = vi.fn(async () => {});
const phase = () => useDictationStore.getState().phase;
const settle = () => new Promise((r) => setTimeout(r, 0));
/** One second of speech-level audio at 16 kHz */
const speech = () => new Float32Array(16_000).fill(0.3);

async function startRecording(): Promise<void> {
  chordDown();
  await settle();
  openMic();
  await settle();
  await settle();
}

beforeEach(() => {
  vi.stubGlobal("window", { api: { dictation: { sendAudio: vi.fn() } } });
  vi.stubGlobal("document", { activeElement: null });
  vi.stubGlobal("HTMLElement", class {});
  vi.stubGlobal("navigator", { clipboard: { writeText } });
  useToastStore.setState({ toasts: [] });
  stopCapture.mockClear();
  writeText.mockClear();
});

afterEach(() => {
  dismissDictation("button");
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("recording while Exegol is in the background", () => {
  it("leaving Exegol during a recording keeps it going, mic open, no toast", async () => {
    await startRecording();
    expect(phase()).toBe("listening");
    appFocusChanged(false);
    feed(speech());
    appFocusChanged(true);
    expect(phase()).toBe("listening");
    expect(stopCapture).not.toHaveBeenCalled();
    expect(useToastStore.getState().toasts).toHaveLength(0);
  });

  it("focus lost while starting: the capture that resolves later still records", async () => {
    chordDown();
    await settle();
    expect(phase()).toBe("starting");
    appFocusChanged(false);
    openMic();
    await settle();
    await settle();
    expect(phase()).toBe("listening");
  });

  it("a hold cut by a blur: the lost keyup does not stop, the next press does", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    await startRecording();
    vi.setSystemTime(Date.now() + 2_000);
    appFocusChanged(false);
    chordUp();
    expect(phase()).toBe("listening");
    chordDown();
    // Nothing heard: stopping ends the recording at once
    expect(phase()).toBe("idle");
    expect(stopCapture).toHaveBeenCalled();
  });
});

describe("cancel", () => {
  it("copies a long dictation instead of discarding it", async () => {
    await startRecording();
    for (let i = 0; i < 16; i++) feed(speech());
    useDictationStore.getState().set({ partial: "a long narration" });
    dismissDictation("esc");
    await settle();
    expect(phase()).toBe("idle");
    expect(writeText).toHaveBeenCalledWith("a long narration");
    expect(useToastStore.getState().toasts[0]?.title).toBe("Dictation cancelled, text copied");
  });

  it("drops a short one", async () => {
    await startRecording();
    feed(speech());
    useDictationStore.getState().set({ partial: "oops" });
    dismissDictation("esc");
    await settle();
    expect(writeText).not.toHaveBeenCalled();
  });
});

describe("diagnostics: what ended a dictation reaches main's log (never the text)", () => {
  const callOf = (path: string) => trpcMutate.mock.calls.find(([p]) => p === path)?.[1];

  it("an Esc cancel says it was Esc", async () => {
    trpcMutate.mockClear();
    await startRecording();
    dismissDictation("esc");
    expect(callOf("dictation.cancel")).toEqual({ sessionId: "s1", source: "esc" });
  });

  it("a stop says what stopped it: the shortcut here", async () => {
    trpcMutate.mockClear();
    await startRecording();
    feed(speech());
    chordDown();
    await settle();
    expect(callOf("dictation.stop")).toMatchObject({ sessionId: "s1", by: "chord" });
  });

  it("a stop with nothing heard is logged as a cancel", async () => {
    trpcMutate.mockClear();
    await startRecording();
    chordDown();
    expect(callOf("dictation.cancel")).toEqual({ sessionId: "s1", source: "nothing-heard" });
  });
});
