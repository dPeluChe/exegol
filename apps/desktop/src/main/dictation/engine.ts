import { availableParallelism } from "node:os";
import { join } from "node:path";
import { type DictationEngineState, DICTATION_SAMPLE_RATE as SAMPLE_RATE } from "@exegol/shared";
import { type UtilityProcess, utilityProcess } from "electron";
import { broadcast } from "../lib/event-bus";
import { logger } from "../lib/logger";
import { findModel } from "../models/catalog";
import { MODELS_DIR, modelDir } from "../models/manager";
import { getMainWindow } from "../windows/main-window-ref";
import type { EngineReply, EngineRequest } from "./engine-protocol";
import { recognizerSpec } from "./model-config";

const LOAD_TIMEOUT_MS = 120_000;
const DECODE_TIMEOUT_MS = 180_000;
const PROBE_TIMEOUT_MS = 20_000;
/** A crashed engine comes back after these delays; one more crash and it stays down */
const RESPAWN_DELAYS_MS = [1_000, 5_000, 30_000];

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
type Final = Omit<Extract<EngineReply, { type: "final" }>, "type" | "sessionId">;

const finals = new Map<string, Waiter<Final>>();
let idleTimer: ReturnType<typeof setTimeout> | null = null;
let idleMs = 10 * 60_000;
let lastTouch = 0;
let crashes = 0;
let respawnTimer: ReturnType<typeof setTimeout> | null = null;
let probe: Promise<{ ok: boolean; error: string | null }> | null = null;
let spawnedAt = 0;
let loadStartedAt = 0;
/** The last cold start, for the dictation log line: null while it has not happened */
let coldStart: { spawnMs: number | null; loadMs: number | null } = { spawnMs: null, loadMs: null };

export const engineTimings = () => ({ ...coldStart });

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
    case "ready":
      coldStart.spawnMs = Date.now() - spawnedAt;
      return;
    case "loaded":
      coldStart.loadMs = Date.now() - loadStartedAt;
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
    case "partial": {
      // Dictated words go to the window that dictates, not to every window
      const win = getMainWindow();
      if (win && !win.isDestroyed()) {
        win.webContents.send("dictation:partial", { sessionId: msg.sessionId, text: msg.text });
      }
      return;
    }
    case "final":
      crashes = 0;
      finals.get(msg.sessionId)?.resolve(msg);
      finals.delete(msg.sessionId);
      return;
    case "failed":
      logger.warn(`[Dictation] transcription failed: ${msg.error}`);
      finals.get(msg.sessionId)?.reject(new Error(msg.error));
      finals.delete(msg.sessionId);
      return;
  }
}

const fork = (): UtilityProcess =>
  utilityProcess.fork(join(__dirname, "dictation-engine.js"), [`--models-root=${MODELS_DIR}`], {
    serviceName: "Exegol Dictation",
    stdio: "ignore",
  });

function spawn(): UtilityProcess {
  spawnedAt = Date.now();
  coldStart = { spawnMs: null, loadMs: null };
  const proc = fork();
  proc.on("message", (msg: EngineReply) => onReply(msg));
  proc.on("exit", (code) => {
    if (child !== proc) return;
    const wanted = modelId;
    reset();
    if (code !== 0) onCrash(code, wanted);
  });
  return proc;
}

/** Back with the same model after a delay; after the last one it stays down until asked again */
function onCrash(code: number, wanted: string | null): void {
  if (!wanted) {
    logger.warn(`[Dictation] engine exited with code ${code}`);
    return;
  }
  const delay = RESPAWN_DELAYS_MS[crashes++];
  if (delay === undefined) {
    logger.warn(`[Dictation] engine exited with code ${code} again; not restarted`);
    setState("failed");
    return;
  }
  logger.warn(`[Dictation] engine exited with code ${code}; restarting in ${delay / 1000}s`);
  respawnTimer = setTimeout(() => {
    respawnTimer = null;
    if (!child) ensureModel(wanted).catch(() => {});
  }, delay);
  respawnTimer.unref?.();
}

/** Loads the addon once in a throwaway engine process: the dictation UI hides when it cannot */
export function probeEngine(): Promise<{ ok: boolean; error: string | null }> {
  probe ??= new Promise((resolve) => {
    let proc: UtilityProcess;
    try {
      proc = fork();
    } catch (err) {
      resolve({ ok: false, error: err instanceof Error ? err.message : String(err) });
      return;
    }
    const done = (ok: boolean, error: string | null) => {
      clearTimeout(timer);
      proc.removeAllListeners();
      proc.kill();
      if (!ok) logger.warn(`[Dictation] speech engine unavailable: ${error}`);
      resolve({ ok, error });
    };
    const timer = setTimeout(
      () => done(false, "the speech engine did not start"),
      PROBE_TIMEOUT_MS,
    );
    proc.on("message", (msg: EngineReply) => {
      if (msg.type === "ready") done(true, null);
    });
    proc.on("exit", (code) =>
      done(false, `the speech engine could not load on this system (exit ${code})`),
    );
  });
  return probe;
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
  loadStartedAt = Date.now();
  coldStart.loadMs = null;
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

/** `decodeMs` counts from stop: with a cold engine it includes what was left of the model load */
export async function finishSession(sessionId: string): Promise<Final & { decodeMs: number }> {
  touch();
  if (!child) throw new Error("the speech engine is not running");
  const stoppedAt = Date.now();
  const done = waiter<Final>(DECODE_TIMEOUT_MS, "transcribing", (w) => {
    finals.set(sessionId, w);
  });
  send({ type: "finish", sessionId });
  try {
    const { text, phrases, phraseMs, fullPass } = await done;
    return { text, phrases, phraseMs, fullPass, decodeMs: Date.now() - stoppedAt };
  } finally {
    touch();
  }
}

export const modelLoaded = (id: string): boolean => modelId === id && state === "ready";

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
  if (respawnTimer) clearTimeout(respawnTimer);
  respawnTimer = null;
  crashes = 0;
  const proc = child;
  if (!proc) return;
  reset();
  proc.kill();
}
