import workletUrl from "./capture-worklet.ts?worker&url";

export interface Capture {
  /** Live level for the waveform */
  analyser: AnalyserNode;
  stop: () => void;
}

/** Opens the mic (mono, the OS's echo/noise/gain processing on) and streams 16 kHz chunks */
export async function startCapture(onChunk: (samples: Float32Array) => void): Promise<Capture> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      channelCount: 1,
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    },
  });
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
    node.port.onmessage = (e: MessageEvent<Float32Array>) => onChunk(e.data);
    source.connect(analyser);
    source.connect(node);
    return {
      analyser,
      stop: () => {
        node.port.onmessage = null;
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
