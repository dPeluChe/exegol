/**
 * Text to speech, run as an Electron utilityProcess beside the dictation engine: sherpa-onnx-node
 * synthesizes here, one sentence at a time, so playback starts on the first one. It only opens
 * files under the models folder main passes at fork.
 */
import { realpathSync } from "node:fs";
import * as sherpa from "sherpa-onnx-node";
import { isInside, specPaths } from "../dictation/model-config";
import type { TtsSpec } from "./tts-config";
import type { TtsReply, TtsRequest } from "./tts-protocol";

const modelsRoot = process.argv
  .find((a) => a.startsWith("--models-root="))
  ?.slice("--models-root=".length);

let loadedKey: string | null = null;
let tts: sherpa.OfflineTts | null = null;
/** The utterance that may play: a newer one or a cancel replaces it */
let latest = "";
let queue: Promise<void> = Promise.resolve();

const port = process.parentPort;
const reply = (message: TtsReply) => port.postMessage(message);
const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err));

function assertModelPaths(spec: TtsSpec): void {
  if (!modelsRoot) throw new Error("no models folder");
  const root = realpathSync(modelsRoot);
  for (const path of specPaths(spec.config)) {
    if (!isInside(root, realpathSync(path)))
      throw new Error("model file outside the models folder");
  }
}

async function ensureLoaded(spec: TtsSpec): Promise<number> {
  if (tts && loadedKey === spec.key) return 0;
  const started = Date.now();
  tts = null;
  loadedKey = null;
  assertModelPaths(spec);
  tts = await sherpa.OfflineTts.createAsync(spec.config);
  loadedKey = spec.key;
  return Date.now() - started;
}

async function speak(msg: Extract<TtsRequest, { type: "speak" }>): Promise<void> {
  const job = {
    id: msg.id,
    get cancelled() {
      return latest !== msg.id;
    },
  };
  if (job.cancelled) return;
  try {
    const loadMs = await ensureLoaded(msg.spec);
    const started = Date.now();
    let spoken = 0;
    for (const text of msg.sentences) {
      if (job.cancelled || !tts) break;
      const audio = await tts.generateAsync({
        text,
        sid: msg.sid,
        speed: msg.speed,
        onProgress: () => (job.cancelled ? 0 : 1),
      });
      if (job.cancelled) break;
      spoken++;
      reply({ type: "audio", id: job.id, samples: audio.samples, sampleRate: audio.sampleRate });
    }
    reply({ type: "done", id: job.id, sentences: spoken, loadMs, synthMs: Date.now() - started });
  } catch (err) {
    reply({ type: "failed", id: job.id, error: job.cancelled ? "cancelled" : errorText(err) });
  }
}

function handle(msg: TtsRequest): void {
  if (msg.type === "cancel") {
    if (latest === msg.id) latest = "";
    return;
  }
  latest = msg.id;
  // One synthesis at a time: the addon's engine is not shared between concurrent calls
  queue = queue.then(() => speak(msg));
}

port.on("message", (event) => handle(event.data as TtsRequest));
reply({ type: "ready" });
