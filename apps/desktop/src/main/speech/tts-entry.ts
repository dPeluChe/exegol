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

/** What went wrong, for the log: never a message that quotes the text, no folder names */
function engineError(err: unknown, sentences: string[]): string {
  const text = errorText(err);
  if (sentences.some((s) => text.includes(s))) return "engine error";
  return text.replace(/\/[^\s'"]+/g, "<path>").slice(0, 160);
}

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
  const { id } = msg;
  const cancelled = () => latest !== id;
  if (cancelled()) return;
  try {
    const loadMs = await ensureLoaded(msg.spec);
    const started = Date.now();
    let spoken = 0;
    for (const text of msg.sentences) {
      if (cancelled() || !tts) break;
      const audio = await tts.generateAsync({
        text,
        sid: msg.sid,
        speed: msg.speed,
        // Electron refuses external buffers (V8 memory cage): the addon must copy the samples
        enableExternalBuffer: false,
        onProgress: () => (cancelled() ? 0 : 1),
      });
      if (cancelled()) break;
      spoken++;
      reply({ type: "audio", id, samples: audio.samples, sampleRate: audio.sampleRate });
    }
    reply({ type: "done", id, sentences: spoken, loadMs, synthMs: Date.now() - started });
  } catch (err) {
    reply({
      type: "failed",
      id,
      error: cancelled() ? "cancelled" : engineError(err, msg.sentences),
    });
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
