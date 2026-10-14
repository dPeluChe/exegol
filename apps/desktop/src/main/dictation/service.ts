import {
  cleanDictation,
  DEFAULT_SPEECH_MODEL_KEY,
  DICTATION_SAMPLE_RATE,
  type DictationCancelSource,
  type DictationInput,
  type DictationSettings,
  type DictationStatus,
  type DictationStopReason,
  type DictationTargetKind,
  dictationSettingsOf,
  dictationVocabulary,
  parseChord,
  type SpeechModelEntry,
} from "@exegol/shared";
import type Database from "libsql";
import { nanoid } from "nanoid";
import { getProject } from "../db/queries/projects";
import { getAppSettings, getJsonSetting, setJsonSetting } from "../db/queries/settings";
import { broadcast } from "../lib/event-bus";
import { logger } from "../lib/logger";
import { DEFAULT_MODEL_ID, findModel, MODEL_CATALOG } from "../models/catalog";
import { modelDir, modelStatus } from "../models/manager";
import { armDictationSession, disarmDictationSession, pauseDictationSession } from "./background";
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
import { holdMedia, type MediaHold, mediaBackend } from "./media-pause";
import { disarmMic, micStatus } from "./mic";
import { hasRecognizer, vocabularyUse } from "./model-config";
import { RecordingBuffer, saveRecording } from "./recordings";
import { prepareVocabulary, type VocabularyInfo } from "./vocabulary";

/** Set once a recording started here: Linux and Windows have no OS answer to remember */
const MIC_USED_KEY = "dictation_mic_used";

interface Active {
  id: string;
  modelId: string;
  startedAt: number;
  /** The model was not loaded when this dictation started: the log line carries the load split */
  cold: boolean;
  /** The players this dictation paused; null when the setting is off */
  media: MediaHold | null;
  /** Its audio, kept only with Settings > Dictation > Keep recordings on */
  audio: RecordingBuffer | null;
  /** No audio reaches the engine or the recording, and the limit stands still */
  paused: boolean;
  vocabulary: VocabularyInfo | null;
}

/** While paused the players stay paused this long before the safety timer gives them back */
const PAUSED_MEDIA_HOLD_MS = 30 * 60_000;

let active: Active | null = null;
/** A stopped dictation still transcribing: Esc meanwhile means nothing was inserted */
let stopping: { id: string; cancelled: boolean } | null = null;
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
    if (active) cancelDictation(active.id, "disabled");
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

/** Global terms plus the target project's; a write failure dictates without them */
async function vocabularyFor(
  settings: DictationSettings,
  entry: SpeechModelEntry,
  projectId: string | null,
) {
  const terms = dictationVocabulary(settings, projectId);
  return prepareVocabulary(entry.id, modelDir(entry.id), terms, settings.vocabularyBoost).catch(
    (err) => {
      const reason = (err as NodeJS.ErrnoException)?.code ?? "write failed";
      logger.warn(`[Dictation] vocabulary not used: ${reason}`);
      return { spec: null, info: null };
    },
  );
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
      vocabulary: vocabularyUse(entry.id) !== null,
    },
    engine: engineState(),
    engineAvailable: engine.ok,
    engineError: engine.error,
  };
}

export async function startDictation(
  db: Database.Database,
  input: DictationInput = "default",
  projectId: string | null = null,
) {
  const settings = dictationSettings(db);
  disarmMic();
  if (!settings.enabled) throw new Error("dictation is off in Settings > Dictation");
  if (!(await probeEngine()).ok) throw new Error("the speech engine cannot run on this system");
  const { entry, ready } = await pickModel(db);
  if (!ready) throw new Error("no speech model is downloaded");
  const vocabulary = await vocabularyFor(settings, entry, projectId);
  // Past the longest dictation the music comes back even if no end arrives (renderer died)
  const holdMs = (settings.maxSeconds + 30) * 1000;
  // A dictation replacing a running one keeps its pause while unreleased: resume then pause races
  let media = active?.media?.extend(holdMs) ? active.media : null;
  if (active) {
    if (active.media !== media) active.media?.release();
    cancelSession(active.id);
    active = null;
  }
  if (!media && settings.pauseMedia) {
    media = holdMedia(holdMs, mediaBackend({ direct: settings.pauseMediaDirect }));
  }
  const id = nanoid(16);
  try {
    active = {
      id,
      modelId: entry.id,
      startedAt: Date.now(),
      cold: warmedCold ?? !modelLoaded(entry.id, settings.language, vocabulary.spec),
      media,
      audio: settings.keepRecordings ? new RecordingBuffer(settings.maxSeconds) : null,
      paused: false,
      vocabulary: vocabulary.info,
    };
    warmedCold = null;
    // The model loads while the user speaks: audio waits in the engine until it is ready
    ensureModel(entry.id, settings.language, vocabulary.spec).catch(() => {});
    beginSession(id, settings.maxSeconds);
    armDictationSession(id, settings.maxSeconds);
  } catch (err) {
    media?.release();
    active = null;
    throw err;
  }
  logger.info(`[Dictation] input: ${input}`);
  if (!getJsonSetting(db, MIC_USED_KEY, false)) setJsonSetting(db, MIC_USED_KEY, true);
  return { sessionId: id, modelId: entry.id, kind: entry.kind, maxSeconds: settings.maxSeconds };
}

export function dictationAudio(sessionId: unknown, samples: unknown): void {
  if (!active || sessionId !== active.id || active.paused) return;
  if (!(samples instanceof Float32Array)) return;
  if (samples.length === 0 || samples.length > DICTATION_SAMPLE_RATE) return;
  feedAudio(active.id, samples);
  active.audio?.push(samples);
}

/** Same session on resume: target, model and text so far are kept. Players stay paused */
export function pauseDictation(sessionId: string, paused: boolean): { ok: boolean } {
  if (!active || active.id !== sessionId) return { ok: false };
  if (active.paused === paused) return { ok: true };
  active.paused = paused;
  const remainingMs = pauseDictationSession(paused);
  active.media?.extend(remainingMs + 30_000 + (paused ? PAUSED_MEDIA_HOLD_MS : 0));
  logger.info(`[Dictation] ${paused ? "paused" : "resumed"}`);
  return { ok: true };
}

export async function stopDictation(
  db: Database.Database,
  input: {
    sessionId: string;
    durationMs: number;
    projectId: string | null;
    targetKind: DictationTargetKind;
    by: DictationStopReason;
  },
): Promise<{ text: string }> {
  if (!active || active.id !== input.sessionId) {
    throw new Error("this dictation is no longer running");
  }
  const { modelId, cold, media, audio, vocabulary } = active;
  active = null;
  disarmDictationSession();
  media?.release();
  const ending = { id: input.sessionId, cancelled: false };
  stopping = ending;
  const { text, decodeMs, phrases, phraseMs, fullPass } = await finishSession(
    input.sessionId,
  ).finally(() => {
    if (stopping === ending) stopping = null;
  });
  const phraseLog =
    phrases > 0 ? `${phrases} phrases decoded while recording in ${phraseMs}ms, ` : "";
  // Lengths and timings only: dictated text never goes to the log (bug reports are public)
  logger.info(
    `[Dictation] stopped by ${input.by}; ${modelId}: ${Math.round(input.durationMs / 100) / 10}s of audio, ${text.length} chars; ${loadSplit(cold)}${phraseLog}decode after stop ${decodeMs}ms${fullPass ? " (full pass)" : ""}`,
  );
  if (text) {
    const settings = dictationSettings(db);
    const saved = addDictation(db, {
      text,
      modelId,
      durationMs: Math.max(0, Math.round(input.durationMs)),
      projectId: input.projectId,
      targetKind: input.targetKind,
    });
    pruneDictations(db, { days: settings.retentionDays, max: settings.retentionMax });
    broadcast("dictation:done", {});
    const inserted = cleanDictation(text, settings);
    if (audio && inserted) {
      const projectName = saved.projectId ? (getProject(db, saved.projectId)?.name ?? null) : null;
      const at = new Date();
      setImmediate(() => {
        if (ending.cancelled) return;
        void saveRecording({
          sessionId: input.sessionId,
          audio,
          at,
          projectId: saved.projectId,
          projectName,
          target: input.targetKind,
          modelId,
          transcribeMs: decodeMs,
          historyId: saved.id,
          text: inserted,
          rawText: text,
          vocabulary,
        });
      });
    }
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
export async function warmDictation(
  db: Database.Database,
  projectId: string | null = null,
): Promise<{ ok: boolean }> {
  const settings = dictationSettings(db);
  if (!settings.enabled || !(await probeEngine()).ok) return { ok: false };
  const { entry, ready } = await pickModel(db);
  if (!ready) return { ok: false };
  const { spec } = await vocabularyFor(settings, entry, projectId);
  warmedCold = !modelLoaded(entry.id, settings.language, spec);
  ensureModel(entry.id, settings.language, spec).catch(() => {});
  return { ok: true };
}

export function cancelDictation(sessionId: string, source: DictationCancelSource): void {
  if (stopping?.id === sessionId) stopping.cancelled = true;
  if (active?.id !== sessionId) return;
  const secs = Math.round((Date.now() - active.startedAt) / 100) / 10;
  logger.info(`[Dictation] cancelled after ${secs}s (${source})`);
  active.media?.release();
  active = null;
  disarmDictationSession();
  cancelSession(sessionId);
}
