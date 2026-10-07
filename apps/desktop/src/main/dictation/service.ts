import {
  DEFAULT_SPEECH_MODEL_KEY,
  type DictationSettings,
  type DictationStatus,
  type DictationTargetKind,
  dictationSettingsOf,
  parseChord,
} from "@exegol/shared";
import type Database from "libsql";
import { nanoid } from "nanoid";
import { getAppSettings, getJsonSetting, setJsonSetting } from "../db/queries/settings";
import { logger } from "../lib/logger";
import { DEFAULT_MODEL_ID, findModel, MODEL_CATALOG } from "../models/catalog";
import { modelStatus } from "../models/manager";
import {
  beginSession,
  cancelSession,
  engineState,
  ensureModel,
  feedAudio,
  finishSession,
  setIdleUnload,
  stopEngine,
} from "./engine";
import { addDictation, hasDictations, pruneDictations } from "./history";
import { setDictationChord } from "./keys";
import { micStatus } from "./mic";
import { hasRecognizer } from "./model-config";

/** Set once a recording started here: Linux and Windows have no OS answer to remember */
const MIC_USED_KEY = "dictation_mic_used";
const SESSION_ID_RE = /^[A-Za-z0-9_-]{8,32}$/;

interface Active {
  id: string;
  modelId: string;
  startedAt: number;
}

let active: Active | null = null;

export const dictationActive = (): boolean => active !== null;

export function dictationSettings(db: Database.Database): DictationSettings {
  return dictationSettingsOf(getAppSettings(db).dictation);
}

/** Startup and every settings save: the idle timer, the webview chord, off frees the model */
export function applyDictationSettings(settings: DictationSettings): void {
  setIdleUnload(settings.idleUnloadMinutes);
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
  const { entry, ready } = await pickModel(db);
  const mic = micStatus();
  return {
    platform: process.platform,
    mic,
    micEverGranted:
      (process.platform === "darwin" && mic === "granted") ||
      getJsonSetting(db, MIC_USED_KEY, false) ||
      hasDictations(db),
    model: {
      id: entry.id,
      name: entry.name,
      kind: entry.kind,
      ready,
      sizeBytes: entry.sizeBytes,
    },
    engine: engineState(),
  };
}

export async function startDictation(db: Database.Database) {
  const settings = dictationSettings(db);
  if (!settings.enabled) throw new Error("dictation is off in Settings > Dictation");
  const { entry, ready } = await pickModel(db);
  if (!ready) throw new Error("no speech model is downloaded");
  if (active) cancelDictation(active.id);
  const id = nanoid(16);
  active = { id, modelId: entry.id, startedAt: Date.now() };
  // The model loads while the user speaks: audio waits in the engine until it is ready
  ensureModel(entry.id).catch(() => {});
  beginSession(id, settings.maxSeconds);
  if (!getJsonSetting(db, MIC_USED_KEY, false)) setJsonSetting(db, MIC_USED_KEY, true);
  return { sessionId: id, modelId: entry.id, kind: entry.kind, maxSeconds: settings.maxSeconds };
}

export function dictationAudio(sessionId: unknown, samples: unknown): void {
  if (!active || sessionId !== active.id || !(samples instanceof Float32Array)) return;
  if (samples.length === 0 || samples.length > 16_000) return;
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
  if (!active || active.id !== input.sessionId || !SESSION_ID_RE.test(input.sessionId)) {
    throw new Error("this dictation is no longer running");
  }
  const { modelId, startedAt } = active;
  active = null;
  const text = await finishSession(input.sessionId);
  // Lengths and timings only: dictated text never goes to the log (bug reports are public)
  logger.info(
    `[Dictation] ${modelId}: ${Math.round(input.durationMs / 100) / 10}s of audio, ${text.length} chars in ${Date.now() - startedAt}ms`,
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
  }
  return { text };
}

export function cancelDictation(sessionId: string): void {
  if (active?.id !== sessionId) return;
  active = null;
  cancelSession(sessionId);
}
