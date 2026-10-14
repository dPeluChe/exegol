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
const drain = vi.fn(async () => {});
vi.mock("./capture", () => ({
  startCapture: (onChunk: (samples: Float32Array) => void) => {
    feed = onChunk;
    return new Promise((resolve) => {
      openMic = () => resolve({ stop: stopCapture, drain, analyser: null });
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
  drain.mockReset();
  drain.mockImplementation(async () => {});
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
    await settle();
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
    await settle();
    expect(callOf("dictation.cancel")).toEqual({ sessionId: "s1", source: "nothing-heard" });
  });
});

describe("a stop waits for the whole transcript", () => {
  function deferred<T>() {
    let resolve: (value: T) => void = () => {};
    const promise = new Promise<T>((r) => {
      resolve = r;
    });
    return { promise, resolve };
  }

  it("audio still in the worklet reaches main before the stop", async () => {
    const order: string[] = [];
    vi.stubGlobal("window", {
      api: { dictation: { sendAudio: vi.fn(() => order.push("audio")) } },
    });
    trpcMutate.mockClear();
    await startRecording();
    feed(speech());
    drain.mockImplementationOnce(async () => {
      feed(speech());
    });
    trpcMutate.mockImplementationOnce(async (path: string) => {
      order.push(path);
      return { text: "" };
    });
    chordDown();
    await settle();
    expect(order).toEqual(["audio", "audio", "dictation.stop"]);
  });

  it("Enter or the chord again while transcribing: one stop, one insert of the full text", async () => {
    trpcMutate.mockClear();
    await startRecording();
    feed(speech());
    const flushed = deferred<void>();
    drain.mockImplementationOnce(() => flushed.promise);
    const stopped = deferred<{ text: string }>();
    trpcMutate.mockImplementationOnce(() => stopped.promise);
    chordDown();
    expect(phase()).toBe("transcribing");
    chordDown();
    flushed.resolve();
    await settle();
    chordDown();
    chordUp();
    await settle();
    expect(phase()).toBe("transcribing");
    expect(writeText).not.toHaveBeenCalled();
    stopped.resolve({ text: "first phrase and the last words" });
    await settle();
    await settle();
    expect(trpcMutate.mock.calls.filter(([p]) => p === "dictation.stop")).toHaveLength(1);
    expect(writeText).toHaveBeenCalledTimes(1);
    expect(writeText).toHaveBeenCalledWith("first phrase and the last words");
    expect(phase()).toBe("idle");
  });

  it("Esc while transcribing inserts nothing", async () => {
    await startRecording();
    feed(speech());
    const stopped = deferred<{ text: string }>();
    trpcMutate.mockImplementationOnce(() => stopped.promise);
    chordDown();
    await settle();
    expect(phase()).toBe("transcribing");
    dismissDictation("esc");
    stopped.resolve({ text: "never inserted" });
    await settle();
    expect(writeText).not.toHaveBeenCalled();
    expect(phase()).toBe("idle");
  });

  it("Esc during the flush stops before main is asked", async () => {
    trpcMutate.mockClear();
    await startRecording();
    feed(speech());
    const flushed = deferred<void>();
    drain.mockImplementationOnce(() => flushed.promise);
    chordDown();
    dismissDictation("esc");
    flushed.resolve();
    await settle();
    expect(trpcMutate.mock.calls.some(([p]) => p === "dictation.stop")).toBe(false);
    expect(phase()).toBe("idle");
  });
});

describe("auto insert after silence", () => {
  const silence = () => new Float32Array(16_000);

  it("inserts once through the normal stop, after the full transcript, never Enter", async () => {
    const { trpcInvoke } = await import("../trpc-client");
    vi.mocked(trpcInvoke).mockResolvedValueOnce({
      dictation: { enabled: true, autoInsert: true, autoInsertSilenceSec: 5, pressEnter: true },
    });
    trpcMutate.mockClear();
    await startRecording();
    feed(speech());
    for (let i = 0; i < 3; i++) feed(silence());
    expect(useDictationStore.getState().autoInsertMs).toBe(2000);
    trpcMutate.mockImplementationOnce(async () => ({ text: "all of it" }));
    feed(silence());
    feed(silence());
    await settle();
    await settle();
    const stops = trpcMutate.mock.calls.filter(([p]) => p === "dictation.stop");
    expect(stops).toHaveLength(1);
    expect(stops[0]?.[1]).toMatchObject({ by: "silence" });
    expect(writeText).toHaveBeenCalledTimes(1);
    expect(writeText).toHaveBeenCalledWith("all of it");
    expect(phase()).toBe("idle");
  });

  it("a click on the countdown keeps the dictation going", async () => {
    const { trpcInvoke } = await import("../trpc-client");
    vi.mocked(trpcInvoke).mockResolvedValueOnce({
      dictation: { enabled: true, autoInsert: true, autoInsertSilenceSec: 5 },
    });
    const { cancelAutoInsert } = await import("./controller");
    trpcMutate.mockClear();
    await startRecording();
    feed(speech());
    for (let i = 0; i < 3; i++) feed(silence());
    cancelAutoInsert();
    expect(useDictationStore.getState().autoInsertMs).toBeNull();
    for (let i = 0; i < 5; i++) feed(silence());
    await settle();
    expect(phase()).toBe("listening");
    expect(trpcMutate.mock.calls.some(([p]) => p === "dictation.stop")).toBe(false);
  });
});
