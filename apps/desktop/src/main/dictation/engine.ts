import { availableParallelism } from "node:os";
import { join } from "node:path";
import type { DictationEngineState } from "@exegol/shared";
import { type UtilityProcess, utilityProcess } from "electron";
import { broadcast } from "../lib/event-bus";
import { logger } from "../lib/logger";
import { findModel } from "../models/catalog";
import { MODELS_DIR, modelDir } from "../models/manager";
import type { EngineReply, EngineRequest } from "./engine-protocol";
import { SAMPLE_RATE } from "./engine-protocol";
import { recognizerSpec } from "./model-config";

const LOAD_TIMEOUT_MS = 120_000;
const DECODE_TIMEOUT_MS = 180_000;

interface Waiter<T> {
  resolve: (value: T) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

let child: UtilityProcess | null = null;
let state: DictationEngineState = "unloaded";
let modelId: string | null = null;
let loadWaiter: Waiter<void> | null = null;
let loadPromise: Promise<void> | null = null;
const finals = new Map<string, Waiter<string>>();
let idleTimer: ReturnType<typeof setTimeout> | null = null;
let idleMs = 10 * 60_000;
let lastTouch = 0;

export const engineState = (): DictationEngineState => state;

function setState(next: DictationEngineState): void {
  state = next;
  broadcast("dictation:engine", { state });
}

function send(message: EngineRequest): void {
  child?.postMessage(message);
}

function waiter<T>(ms: number, what: string, done: (w: Waiter<T>) => void): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${what} timed out`)), ms);
    done({
      resolve: (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      reject: (e) => {
        clearTimeout(timer);
        reject(e);
      },
      timer,
    });
  });
}

function onReply(msg: EngineReply): void {
  switch (msg.type) {
    case "loaded":
      setState("ready");
      loadWaiter?.resolve();
      loadWaiter = null;
      return;
    case "load-failed":
      logger.warn(`[Dictation] model ${msg.modelId} failed to load: ${msg.error}`);
      modelId = null;
      setState("failed");
      loadWaiter?.reject(new Error(`the model did not load: ${msg.error}`));
      loadWaiter = null;
      return;
    case "partial":
      broadcast("dictation:partial", { sessionId: msg.sessionId, text: msg.text });
      return;
    case "final":
      finals.get(msg.sessionId)?.resolve(msg.text);
      finals.delete(msg.sessionId);
      return;
    case "failed":
      logger.warn(`[Dictation] transcription failed: ${msg.error}`);
      finals.get(msg.sessionId)?.reject(new Error(msg.error));
      finals.delete(msg.sessionId);
      return;
  }
}

function spawn(): UtilityProcess {
  const proc = utilityProcess.fork(
    join(__dirname, "dictation-engine.js"),
    [`--models-root=${MODELS_DIR}`],
    { serviceName: "Exegol Dictation", stdio: "ignore" },
  );
  proc.on("message", (msg: EngineReply) => onReply(msg));
  proc.on("exit", (code) => {
    if (child !== proc) return;
    if (code !== 0) logger.warn(`[Dictation] engine exited with code ${code}`);
    reset();
  });
  return proc;
}

function reset(): void {
  child = null;
  modelId = null;
  loadPromise = null;
  const err = new Error("the speech engine stopped");
  loadWaiter?.reject(err);
  loadWaiter = null;
  for (const w of finals.values()) w.reject(err);
  finals.clear();
  setState("unloaded");
}

/** Loads the model in the engine process (spawned on demand); resolves once it can decode */
export function ensureModel(id: string): Promise<void> {
  touch();
  if (modelId === id && loadPromise) return loadPromise;
  const entry = findModel(id);
  const threads = Math.max(1, Math.min(4, Math.floor(availableParallelism() / 2)));
  const spec = entry && recognizerSpec(entry, modelDir(id), threads);
  if (!spec) return Promise.reject(new Error("this model cannot dictate yet"));
  child ??= spawn();
  modelId = id;
  setState("loading");
  loadWaiter?.reject(new Error("another model was picked"));
  loadPromise = waiter<void>(LOAD_TIMEOUT_MS, "loading the model", (w) => {
    loadWaiter = w;
  });
  loadPromise.catch(() => {});
  send({ type: "load", modelId: id, spec });
  return loadPromise;
}

export function beginSession(sessionId: string, maxSeconds: number): void {
  touch();
  send({ type: "begin", sessionId, maxSamples: Math.ceil((maxSeconds + 2) * SAMPLE_RATE) });
}

export function feedAudio(sessionId: string, samples: Float32Array): void {
  send({ type: "audio", sessionId, samples });
  // A dictation longer than the idle setting must not lose its engine mid-sentence
  if (Date.now() - lastTouch > 5_000) touch();
}

export function finishSession(sessionId: string): Promise<string> {
  touch();
  if (!child) return Promise.reject(new Error("the speech engine is not running"));
  const done = waiter<string>(DECODE_TIMEOUT_MS, "transcribing", (w) => {
    finals.set(sessionId, w);
  });
  send({ type: "finish", sessionId });
  return done.finally(touch);
}

export function cancelSession(sessionId: string): void {
  send({ type: "cancel", sessionId });
  finals.get(sessionId)?.reject(new Error("cancelled"));
  finals.delete(sessionId);
}

/** Minutes without a dictation before the model is freed */
export function setIdleUnload(minutes: number): void {
  idleMs = minutes * 60_000;
  if (child) touch();
}

function touch(): void {
  lastTouch = Date.now();
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    if (finals.size === 0) stopEngine();
  }, idleMs);
  idleTimer.unref?.();
}

/** Frees the model: the process (and all its memory) goes away */
export function stopEngine(): void {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = null;
  const proc = child;
  if (!proc) return;
  reset();
  proc.kill();
}
