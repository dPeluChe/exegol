/**
 * Speech engine, run as an Electron utilityProcess: sherpa-onnx-node (N-API, no per-Electron
 * rebuild) decodes here so a model load or a long decode never blocks the main process.
 * It only opens files under the models folder main passes at fork.
 */
import { realpathSync } from "node:fs";
import { DICTATION_SAMPLE_RATE as SAMPLE_RATE } from "@exegol/shared";
import * as sherpa from "sherpa-onnx-node";
import type { EngineReply, EngineRequest } from "./engine-protocol";
import { isInside, type RecognizerSpec, specPaths } from "./model-config";

const ROOT_FLAG = "--models-root=";
const modelsRoot = process.argv.find((a) => a.startsWith(ROOT_FLAG))?.slice(ROOT_FLAG.length);

type Loaded =
  | { kind: "offline"; recognizer: sherpa.OfflineRecognizer }
  | { kind: "online"; recognizer: sherpa.OnlineRecognizer };

interface Session {
  id: string;
  maxSamples: number;
  total: number;
  pending: Float32Array[];
  online?: sherpa.OnlineStream;
  lastPartial: string;
}

let loadedId: string | null = null;
let loaded: Loaded | null = null;
let loading: Promise<void> | null = null;
let session: Session | null = null;

const port = process.parentPort;
const reply = (message: EngineReply) => port.postMessage(message);
const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err));

function assertModelPaths(spec: RecognizerSpec): void {
  if (!modelsRoot) throw new Error("no models folder");
  const root = realpathSync(modelsRoot);
  for (const path of specPaths(spec.config)) {
    if (!isInside(root, realpathSync(path)))
      throw new Error("model file outside the models folder");
  }
}

async function load(modelId: string, spec: RecognizerSpec): Promise<void> {
  if (loadedId === modelId && loaded) {
    reply({ type: "loaded", modelId });
    return;
  }
  loaded = null;
  loadedId = null;
  try {
    assertModelPaths(spec);
    loaded =
      spec.kind === "offline"
        ? { kind: "offline", recognizer: await sherpa.OfflineRecognizer.createAsync(spec.config) }
        : { kind: "online", recognizer: new sherpa.OnlineRecognizer(spec.config) };
    loadedId = modelId;
    reply({ type: "loaded", modelId });
  } catch (err) {
    reply({ type: "load-failed", modelId, error: errorText(err) });
  }
}

/** Streaming: feed what arrived and send the partial text when it changed */
function pump(s: Session): void {
  if (loaded?.kind !== "online") return;
  const { recognizer } = loaded;
  s.online ??= recognizer.createStream();
  for (const samples of s.pending.splice(0)) {
    s.online.acceptWaveform({ samples, sampleRate: SAMPLE_RATE });
  }
  while (recognizer.isReady(s.online)) recognizer.decode(s.online);
  const text = recognizer.getResult(s.online).text.trim();
  if (text !== s.lastPartial) {
    s.lastPartial = text;
    reply({ type: "partial", sessionId: s.id, text });
  }
}

function concat(chunks: Float32Array[], total: number): Float32Array {
  const out = new Float32Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return out;
}

async function finish(s: Session): Promise<string> {
  await loading;
  if (!loaded) throw new Error("the model did not load");
  if (loaded.kind === "offline") {
    const stream = loaded.recognizer.createStream();
    stream.acceptWaveform({ samples: concat(s.pending, s.total), sampleRate: SAMPLE_RATE });
    s.pending = [];
    return (await loaded.recognizer.decodeAsync(stream)).text.trim();
  }
  // Trailing silence lets the streaming model emit its last words (upstream example: 0.4 s)
  s.pending.push(new Float32Array(SAMPLE_RATE * 0.4));
  pump(s);
  const { recognizer } = loaded;
  const stream = s.online;
  if (!stream) return "";
  stream.inputFinished();
  while (recognizer.isReady(stream)) recognizer.decode(stream);
  return recognizer.getResult(stream).text.trim();
}

function handle(msg: EngineRequest): void {
  switch (msg.type) {
    case "load":
      loading = load(msg.modelId, msg.spec);
      return;
    case "begin":
      session = {
        id: msg.sessionId,
        maxSamples: msg.maxSamples,
        total: 0,
        pending: [],
        lastPartial: "",
      };
      return;
    case "audio": {
      const s = session;
      if (s?.id !== msg.sessionId || !(msg.samples instanceof Float32Array)) return;
      const room = s.maxSamples - s.total;
      if (room <= 0) return;
      const samples = msg.samples.length > room ? msg.samples.subarray(0, room) : msg.samples;
      s.pending.push(samples);
      s.total += samples.length;
      try {
        pump(s);
      } catch (err) {
        session = null;
        reply({ type: "failed", sessionId: s.id, error: errorText(err) });
      }
      return;
    }
    case "finish": {
      const s = session;
      if (s?.id !== msg.sessionId) {
        reply({ type: "failed", sessionId: msg.sessionId, error: "no such dictation" });
        return;
      }
      session = null;
      finish(s).then(
        (text) => reply({ type: "final", sessionId: s.id, text }),
        (err) => reply({ type: "failed", sessionId: s.id, error: errorText(err) }),
      );
      return;
    }
    case "cancel":
      if (session?.id === msg.sessionId) session = null;
      return;
  }
}

port.on("message", (event) => handle(event.data as EngineRequest));
// The addon loaded (a static import): main's availability probe waits for this
reply({ type: "ready" });
