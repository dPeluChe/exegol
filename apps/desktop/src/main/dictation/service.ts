import {
  DEFAULT_SPEECH_MODEL_KEY,
  DICTATION_SAMPLE_RATE,
  type DictationSettings,
  type DictationStatus,
  type DictationTargetKind,
  dictationSettingsOf,
  parseChord,
} from "@exegol/shared";
import type Database from "libsql";
import { nanoid } from "nanoid";
import { getAppSettings, getJsonSetting, setJsonSetting } from "../db/queries/settings";
import { broadcast } from "../lib/event-bus";
import { logger } from "../lib/logger";
import { DEFAULT_MODEL_ID, findModel, MODEL_CATALOG } from "../models/catalog";
import { modelStatus } from "../models/manager";
import {
  beginSession,
  cancelSession,
  engineState,
  engineTimings,
  ensureModel,
  feedAudio,
  finishSession,
  modelLoaded,
  probeEngine,
  setIdleUnload,
  stopEngine,
} from "./engine";
import { addDictation, pruneDictations } from "./history";
import { setDictationChord } from "./keys";
import { holdMedia } from "./media-pause";
import { disarmMic, micStatus } from "./mic";
import { hasRecognizer } from "./model-config";

/** Set once a recording started here: Linux and Windows have no OS answer to remember */
const MIC_USED_KEY = "dictation_mic_used";

interface Active {
  id: string;
  modelId: string;
  startedAt: number;
  /** The model was not loaded when this dictation started: the log line carries the load split */
  cold: boolean;
  /** Gives back the players this dictation paused */
  releaseMedia: () => void;
}

let active: Active | null = null;
/** Whether the last warm-up found the model unloaded: the start that follows is a cold one.
 *  Null until a warm-up, and again once a start consumed it */
let warmedCold: boolean | null = null;

export const dictationActive = (): boolean => active !== null;

export function dictationSettings(db: Database.Database): DictationSettings {
  return dictationSettingsOf(getAppSettings(db).dictation);
}

/** Startup and every settings save: the idle timer, the webview chord, retention (a lowered one
 *  applies now), off frees the model */
export function applyDictationSettings(db: Database.Database, settings: DictationSettings): void {
  setIdleUnload(settings.idleUnloadMinutes);
  if (pruneDictations(db, { days: settings.retentionDays, max: settings.retentionMax }) > 0) {
    broadcast("dictation:done", {});
  }
  setDictationChord(settings.enabled ? parseChord(settings.shortcut) : null);
  if (!settings.enabled) {
    if (active) cancelDictation(active.id);
    stopEngine();
  }
}

/** The default model when installed, else the first installed one the engine can run */
async function pickModel(db: Database.Database) {
  const defaultId = getJsonSetting(db, DEFAULT_SPEECH_MODEL_KEY, DEFAULT_MODEL_ID);
  const preferred = findModel(defaultId) ?? findModel(DEFAULT_MODEL_ID);
  const candidates = [preferred, ...MODEL_CATALOG.filter((m) => m !== preferred)];
  for (const entry of candidates) {
    if (!entry || !hasRecognizer(entry.id)) continue;
    if ((await modelStatus(entry)).state === "ready") return { entry, ready: true };
  }
  const fallback = findModel(DEFAULT_MODEL_ID);
  if (!fallback) throw new Error("no default speech model");
  return { entry: preferred ?? fallback, ready: false };
}

export async function dictationStatus(db: Database.Database): Promise<DictationStatus> {
  const [{ entry, ready }, engine] = await Promise.all([pickModel(db), probeEngine()]);
  const mic = micStatus();
  return {
    platform: process.platform,
    mic,
    micEverGranted:
      (process.platform === "darwin" && mic === "granted") ||
      getJsonSetting(db, MIC_USED_KEY, false),
    model: {
      id: entry.id,
      name: entry.name,
      kind: entry.kind,
      ready,
      sizeBytes: entry.sizeBytes,
    },
    engine: engineState(),
    engineAvailable: engine.ok,
    engineError: engine.error,
  };
}

export async function startDictation(db: Database.Database) {
  const settings = dictationSettings(db);
  disarmMic();
  if (!settings.enabled) throw new Error("dictation is off in Settings > Dictation");
  if (!(await probeEngine()).ok) throw new Error("the speech engine cannot run on this system");
  const { entry, ready } = await pickModel(db);
  if (!ready) throw new Error("no speech model is downloaded");
  // A dictation replacing a running one keeps its pause: resuming then pausing again would race
  let releaseMedia = active?.releaseMedia ?? null;
  if (active) {
    cancelSession(active.id);
    active = null;
  }
  releaseMedia ??= settings.pauseMedia ? holdMedia((settings.maxSeconds + 30) * 1000) : () => {};
  const id = nanoid(16);
  active = {
    id,
    modelId: entry.id,
    startedAt: Date.now(),
    cold: warmedCold ?? !modelLoaded(entry.id),
    releaseMedia,
  };
  warmedCold = null;
  // The model loads while the user speaks: audio waits in the engine until it is ready
  ensureModel(entry.id).catch(() => {});
  beginSession(id, settings.maxSeconds);
  if (!getJsonSetting(db, MIC_USED_KEY, false)) setJsonSetting(db, MIC_USED_KEY, true);
  return { sessionId: id, modelId: entry.id, kind: entry.kind, maxSeconds: settings.maxSeconds };
}

export function dictationAudio(sessionId: unknown, samples: unknown): void {
  if (!active || sessionId !== active.id || !(samples instanceof Float32Array)) return;
  if (samples.length === 0 || samples.length > DICTATION_SAMPLE_RATE) return;
  feedAudio(active.id, samples);
}

export async function stopDictation(
  db: Database.Database,
  input: {
    sessionId: string;
    durationMs: number;
    projectId: string | null;
    targetKind: DictationTargetKind;
  },
): Promise<{ text: string }> {
  if (!active || active.id !== input.sessionId) {
    throw new Error("this dictation is no longer running");
  }
  const { modelId, cold, releaseMedia } = active;
  active = null;
  releaseMedia();
  const { text, decodeMs, phrases, phraseMs, fullPass } = await finishSession(input.sessionId);
  const phraseLog =
    phrases > 0 ? `${phrases} phrases decoded while recording in ${phraseMs}ms, ` : "";
  // Lengths and timings only: dictated text never goes to the log (bug reports are public)
  logger.info(
    `[Dictation] ${modelId}: ${Math.round(input.durationMs / 100) / 10}s of audio, ${text.length} chars; ${loadSplit(cold)}${phraseLog}decode after stop ${decodeMs}ms${fullPass ? " (full pass)" : ""}`,
  );
  if (text) {
    const settings = dictationSettings(db);
    addDictation(db, {
      text,
      modelId,
      durationMs: Math.max(0, Math.round(input.durationMs)),
      projectId: input.projectId,
      targetKind: input.targetKind,
    });
    pruneDictations(db, { days: settings.retentionDays, max: settings.retentionMax });
    broadcast("dictation:done", {});
  }
  return { text };
}

function loadSplit(cold: boolean): string {
  if (!cold) return "model warm, ";
  const { spawnMs, loadMs } = engineTimings();
  const ms = (n: number | null) => (n === null ? "pending" : `${n}ms`);
  return `engine spawn ${ms(spawnMs)}, model load ${ms(loadMs)}, `;
}

/** Called as a dictation starts in the renderer, before the mic prompt and capture: the engine
 *  spawns and loads the model while the user is still getting ready to speak */
export async function warmDictation(db: Database.Database): Promise<{ ok: boolean }> {
  if (!dictationSettings(db).enabled || !(await probeEngine()).ok) return { ok: false };
  const { entry, ready } = await pickModel(db);
  if (!ready) return { ok: false };
  warmedCold = !modelLoaded(entry.id);
  ensureModel(entry.id).catch(() => {});
  return { ok: true };
}

export function cancelDictation(sessionId: string): void {
  if (active?.id !== sessionId) return;
  active.releaseMedia();
  active = null;
  cancelSession(sessionId);
}
