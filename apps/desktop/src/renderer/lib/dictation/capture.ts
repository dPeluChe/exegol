import type { DictationInput } from "@exegol/shared";
import workletUrl from "./capture-worklet.ts?worker&url";

export interface Capture {
  /** Live level for the waveform */
  analyser: AnalyserNode;
  /** Which mic opened: the picked one, the default, or the default because the picked one failed */
  input: DictationInput;
  /** The opened mic's label (empty without mic permission) */
  label: string;
  /** The mic went away: the system default feeds the same analyser and worklet (its resampler
   *  state and the session carry on). Resolves to the new mic's label */
  switchToDefault: () => Promise<string>;
  stop: () => void;
}

const AUDIO = {
  channelCount: 1,
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
};

/** The picked mic is gone (unplugged) or refuses the constraints: the default is used instead */
export const missingDevice = (err: unknown): boolean =>
  err instanceof DOMException &&
  (err.name === "OverconstrainedError" ||
    err.name === "NotFoundError" ||
    err.name === "NotReadableError");

async function openMic(
  deviceId: string | null,
): Promise<{ stream: MediaStream; input: DictationInput }> {
  if (!deviceId) {
    return {
      stream: await navigator.mediaDevices.getUserMedia({ audio: AUDIO }),
      input: "default",
    };
  }
  try {
    const audio = { ...AUDIO, deviceId: { exact: deviceId } };
    return { stream: await navigator.mediaDevices.getUserMedia({ audio }), input: "selected" };
  } catch (err) {
    if (!missingDevice(err)) throw err;
    return {
      stream: await navigator.mediaDevices.getUserMedia({ audio: AUDIO }),
      input: "fallback",
    };
  }
}

const release = (stream: MediaStream) => {
  for (const track of stream.getTracks()) track.stop();
};

/** Opens the mic (mono, the OS's echo/noise/gain processing on) and streams 16 kHz chunks.
 *  `onLost`: the open mic was unplugged (its track ended or it left the device list) */
export async function startCapture(
  onChunk: (samples: Float32Array) => void,
  deviceId: string | null = null,
  onLost?: () => void,
): Promise<Capture> {
  const opened = await openMic(deviceId);
  let stream = opened.stream;
  const context = new AudioContext();
  try {
    await context.audioWorklet.addModule(workletUrl);
    let source = context.createMediaStreamSource(stream);
    const analyser = context.createAnalyser();
    analyser.fftSize = 1024;
    const node = new AudioWorkletNode(context, "exegol-capture", {
      numberOfInputs: 1,
      numberOfOutputs: 0,
      channelCount: 1,
      channelCountMode: "explicit",
    });
    node.port.onmessage = (e: MessageEvent<Float32Array>) => onChunk(e.data);
    source.connect(analyser);
    source.connect(node);
    let stopped = false;
    let lostSent = false;
    const lost = () => {
      if (stopped || lostSent) return;
      lostSent = true;
      onLost?.();
    };
    const watch = (s: MediaStream) =>
      s.getAudioTracks()[0]?.addEventListener("ended", lost, { once: true });
    // Some unplugs leave the track live but silent: the device list says it is gone
    const deviceChange = async () => {
      const id = stream.getAudioTracks()[0]?.getSettings().deviceId;
      const devices = await navigator.mediaDevices.enumerateDevices().catch(() => null);
      if (id && devices && !devices.some((d) => d.kind === "audioinput" && d.deviceId === id)) {
        lost();
      }
    };
    if (onLost) {
      watch(stream);
      navigator.mediaDevices.addEventListener("devicechange", deviceChange);
    }
    return {
      analyser,
      input: opened.input,
      label: stream.getAudioTracks()[0]?.label ?? "",
      switchToDefault: async () => {
        const next = await navigator.mediaDevices.getUserMedia({ audio: AUDIO });
        if (stopped) {
          release(next);
          return "";
        }
        const nextSource = context.createMediaStreamSource(next);
        nextSource.connect(analyser);
        nextSource.connect(node);
        source.disconnect();
        release(stream);
        source = nextSource;
        stream = next;
        lostSent = false;
        watch(next);
        return next.getAudioTracks()[0]?.label ?? "";
      },
      stop: () => {
        stopped = true;
        navigator.mediaDevices.removeEventListener("devicechange", deviceChange);
        node.port.onmessage = null;
        source.disconnect();
        release(stream);
        void context.close();
      },
    };
  } catch (err) {
    release(stream);
    void context.close();
    throw err;
  }
}

/** Settings > Dictation > Input's Test: the level only, no worklet and nothing leaves the page */
export async function openMicTest(
  deviceId: string | null,
): Promise<Pick<Capture, "analyser" | "input" | "label" | "stop">> {
  const { stream, input } = await openMic(deviceId);
  const context = new AudioContext();
  const source = context.createMediaStreamSource(stream);
  const analyser = context.createAnalyser();
  analyser.fftSize = 1024;
  source.connect(analyser);
  return {
    analyser,
    input,
    label: stream.getAudioTracks()[0]?.label ?? "",
    stop: () => {
      source.disconnect();
      release(stream);
      void context.close();
    },
  };
}
