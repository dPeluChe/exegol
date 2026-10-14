import type { DictationInput } from "@exegol/shared";
import { captureReceiver, type WorkletMessage } from "./capture-drain";
import workletUrl from "./capture-worklet.ts?worker&url";

export interface Capture {
  /** Live level for the waveform */
  analyser: AnalyserNode;
  /** Which mic opened: the picked one, the default, or the default because the picked one failed */
  input: DictationInput;
  /** The opened mic's label (empty without mic permission) */
  label: string;
  /** Resolves once every sample captured so far reached onChunk (or after DRAIN_TIMEOUT_MS) */
  drain: () => Promise<void>;
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

/** Opens the mic (mono, the OS's echo/noise/gain processing on) and streams 16 kHz chunks */
export async function startCapture(
  onChunk: (samples: Float32Array) => void,
  deviceId: string | null = null,
): Promise<Capture> {
  const { stream, input } = await openMic(deviceId);
  const context = new AudioContext();
  try {
    await context.audioWorklet.addModule(workletUrl);
    const source = context.createMediaStreamSource(stream);
    const analyser = context.createAnalyser();
    analyser.fftSize = 1024;
    const node = new AudioWorkletNode(context, "exegol-capture", {
      numberOfInputs: 1,
      numberOfOutputs: 0,
      channelCount: 1,
      channelCountMode: "explicit",
    });
    const receiver = captureReceiver(onChunk);
    node.port.onmessage = (e: MessageEvent<WorkletMessage>) => receiver.receive(e.data);
    source.connect(analyser);
    source.connect(node);
    return {
      analyser,
      input,
      label: stream.getAudioTracks()[0]?.label ?? "",
      drain: () => receiver.drain(() => node.port.postMessage("flush")),
      stop: () => {
        node.port.onmessage = null;
        receiver.settle();
        source.disconnect();
        for (const track of stream.getTracks()) track.stop();
        void context.close();
      },
    };
  } catch (err) {
    for (const track of stream.getTracks()) track.stop();
    void context.close();
    throw err;
  }
}
