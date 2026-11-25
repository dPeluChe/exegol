import {
  DICTATION_SAMPLE_RATE,
  type DictationCancelSource,
  type DictationSettings,
  type DictationStatus,
  type DictationStopReason,
  dictationSettingsOf,
  type Settings,
} from "@exegol/shared";
import type { QueryClient } from "@tanstack/react-query";
import { DICTATION_STATUS_KEY, fetchDictationStatus } from "../../hooks/use-trpc-dictation";
import { recordedMs, useDictationStore } from "../../stores/dictation";
import { useToastStore } from "../../stores/toasts";
import { trpcInvoke, trpcMutate } from "../trpc-client";
import { autoInsertState, countdownMs, resumedVad } from "./auto-insert";
import { startCapture } from "./capture";
import type { Run } from "./dictation-run";
import { finalTarget, snapshot } from "./focus-snapshot";
import { isFlat, peakOf, resolveInput } from "./inputs";
import { copyInstead, heardNothing, insertDictation } from "./insert-dictation";
import { keptOnCancel, sanitizeDictation } from "./target";
import { rms, updateVad, VAD_START } from "./vad";

/** A press held at least this long is hold-to-talk (release stops); shorter toggles */
const HOLD_MS = 350;
/** A stop comes before the last word ends: it listens until quiet, up to the cap */
const TAIL_TICK_MS = 50;
const TAIL_QUIET_MS = 150;
const TAIL_MAX_MS = 600;

let run: Run | null = null;
let pressedAt = 0;
let holdCandidate = false;
let queryClient: QueryClient | null = null;

/** The app's query cache: settings and dictation status are read and written there */
export function bindDictationQueries(client: QueryClient | null): void {
  queryClient = client;
}

/** Null while paused: the waveform goes flat */
export const currentAnalyser = (): AnalyserNode | null =>
  run?.paused ? null : (run?.capture?.analyser ?? null);

const store = () => useDictationStore.getState();
const toast = useToastStore.getState;

function finishRun(): void {
  if (!run) return;
  run.capture?.stop();
  run = null;
}

function reset(): void {
  finishRun();
  holdCandidate = false;
  store().set({
    phase: "idle",
    sessionId: null,
    partial: "",
    error: null,
    anchorPaneId: null,
    downloadRequested: false,
    pausedAt: null,
    inputName: null,
    inputNotice: null,
    autoInsertCountdown: null,
  });
}

function fail(message: string): void {
  finishRun();
  store().set({ phase: "error", error: message, sessionId: null });
}

function onChunk(samples: Float32Array): void {
  const r = run;
  if (!r || r.cancelled || r.paused) return;
  r.vad = updateVad(r.vad, rms(samples), (samples.length / DICTATION_SAMPLE_RATE) * 1000);
  r.peak = peakOf(samples, r.peak);
  if (r.sessionId) window.api.dictation.sendAudio(r.sessionId, samples);
  else r.early.push(samples);
  const auto = autoInsertState(r.vad, {
    enabled: r.settings.autoInsert,
    delaySec: r.settings.autoInsertSilenceSec,
    paused: r.paused,
    dismissed: r.autoInsertOff,
  });
  if (auto.kind === "fire") {
    void stopDictation("silence");
    return;
  }
  const ms = countdownMs(auto);
  const shown = store().autoInsertCountdown;
  if (ms === null) {
    if (shown) store().set({ autoInsertCountdown: null });
  } else if (!shown) {
    store().set({ autoInsertCountdown: { endsAt: Date.now() + ms, ms } });
  }
}

/** A click on the countdown: this dictation goes on until the user inserts or cancels */
export function cancelAutoInsert(): void {
  if (run) run.autoInsertOff = true;
  store().set({ autoInsertCountdown: null });
}

/** The saved mic, found again when the OS gave it a new id: the setting follows the new id */
async function pickInput(settings: DictationSettings): Promise<string | null> {
  if (!settings.inputDeviceId) return null;
  const devices = await navigator.mediaDevices.enumerateDevices().catch(() => []);
  const { id, relinked } = resolveInput(devices, {
    id: settings.inputDeviceId,
    label: settings.inputDeviceLabel,
    groupId: settings.inputDeviceGroupId,
  });
  if (relinked && id) {
    const groupId = devices.find((d) => d.deviceId === id)?.groupId || null;
    const dictation = { ...settings, inputDeviceId: id, inputDeviceGroupId: groupId };
    trpcMutate("settings.update", { dictation })
      .then(() => queryClient?.invalidateQueries({ queryKey: ["settings"] }))
      .catch(() => {});
  }
  return id;
}

/** The open mic was unplugged mid-dictation: the system default takes over in the same session
 *  (pause, text so far and target kept). Main must arm getUserMedia again for the reopen */
async function inputLost(r: Run): Promise<void> {
  const capture = r.capture;
  if (run !== r || !capture || r.cancelled) return;
  const name = store().inputName || r.settings.inputDeviceLabel || "The microphone";
  try {
    await trpcMutate("dictation.requestMic");
    if (run !== r || r.capture !== capture) return;
    const label = await capture.switchToDefault();
    if (run !== r) return;
    store().set({
      inputName: label || null,
      inputNotice: `${name} disconnected, using system default`,
    });
  } catch (err) {
    if (run === r) fail(`Microphone disconnected: ${errorText(err)}`);
  }
}

async function loadStatus(): Promise<DictationStatus> {
  const status = await fetchDictationStatus();
  queryClient?.setQueryData(DICTATION_STATUS_KEY, status);
  return status;
}

const patchStatus = (patch: Partial<DictationStatus>) =>
  queryClient?.setQueryData<DictationStatus>(DICTATION_STATUS_KEY, (s) =>
    s ? { ...s, ...patch } : s,
  );

async function readSettings(): Promise<DictationSettings> {
  const settings = queryClient
    ? await queryClient.ensureQueryData({
        queryKey: ["settings"],
        queryFn: () => trpcInvoke<Settings>("settings.get"),
      })
    : await trpcInvoke<Settings>("settings.get");
  return dictationSettingsOf(settings.dictation);
}

export async function startDictation(): Promise<void> {
  if (run || store().phase === "transcribing") {
    const stage = `phase=${store().phase} run=${!!run}`;
    window.api.reportError?.("dictation", `start ignored: ${stage}`, "");
    return;
  }
  const { target, field, anchor } = snapshot();
  store().set({
    phase: "starting",
    anchorPaneId: anchor,
    targetKind: target.kind,
    targetAgentId: "agentId" in target ? target.agentId : null,
    targetProjectId: target.projectId,
    partial: "",
    error: null,
    pausedAt: null,
    inputName: null,
    inputNotice: null,
    autoInsertCountdown: null,
  });
  const current: Run = {
    settings: dictationSettingsOf(undefined),
    target,
    field,
    capture: null,
    sessionId: null,
    early: [],
    vad: VAD_START,
    peak: 0,
    cancelled: false,
    paused: false,
    stopWhenReady: null,
    autoInsertOff: false,
  };
  run = current;
  // Esc (or a new dictation) during an await below: this start must not touch what follows
  const gone = () => run !== current || current.cancelled;
  const endWith = (patch: Parameters<ReturnType<typeof store>["set"]>[0]) => {
    if (gone()) return;
    finishRun();
    store().set(patch);
  };
  try {
    const [settings, status] = await Promise.all([readSettings(), loadStatus()]);
    if (gone()) return;
    current.settings = settings;
    if (!status.engineAvailable) {
      window.api.reportError?.("dictation", "start ignored: no speech engine", "");
      return reset();
    }
    if (!current.settings.enabled) throw new Error("Dictation is off in Settings > Dictation");
    if (!status.model.ready) return endWith({ phase: "no-model" });
    trpcMutate("dictation.warm", { projectId: target.projectId }).catch(() => {});
    if (target.kind === "browser") {
      await window.api.dictation.markBrowser({
        paneId: target.paneId,
        projectId: target.projectId,
      });
    }
    // Every start: the macOS prompt if not asked yet, and main lets this window open the mic
    const { mic } = await trpcMutate<{ mic: DictationStatus["mic"] }>("dictation.requestMic");
    patchStatus({ mic });
    if (mic === "denied" || mic === "restricted") return endWith({ phase: "mic-denied" });
    if (gone()) return;
    try {
      const deviceId = await pickInput(current.settings);
      if (gone()) return;
      current.capture = await startCapture(onChunk, deviceId, () => void inputLost(current));
    } catch (err) {
      const denied = err instanceof DOMException && err.name === "NotAllowedError";
      return endWith(
        denied
          ? { phase: "mic-denied" }
          : { phase: "error", error: `No microphone: ${errorText(err)}` },
      );
    }
    if (gone()) {
      current.capture.stop();
      return;
    }
    const { input, label } = current.capture;
    store().set({
      inputName: label || null,
      inputNotice:
        input === "fallback"
          ? `${current.settings.inputDeviceLabel || "The selected input"} not found, using system default`
          : null,
    });
    const started = await trpcMutate<{ sessionId: string }>("dictation.start", {
      input,
      projectId: target.projectId,
    });
    patchStatus({ micEverGranted: true });
    if (gone()) {
      void trpcMutate("dictation.cancel", { sessionId: started.sessionId, source: "superseded" });
      return;
    }
    current.sessionId = started.sessionId;
    for (const chunk of current.early.splice(0)) {
      window.api.dictation.sendAudio(started.sessionId, chunk);
    }
    store().set({ phase: "listening", sessionId: started.sessionId, startedAt: Date.now() });
    if (current.stopWhenReady) void stopDictation(current.stopWhenReady);
  } catch (err) {
    if (!gone()) fail(errorText(err));
  }
}

/** Listens for the end of the last word. A cancel meanwhile leaves `run` changed */
async function tailQuiet(r: Run): Promise<void> {
  for (let waited = 0; waited < TAIL_MAX_MS && run === r; waited += TAIL_TICK_MS) {
    if (r.paused || !r.vad.heard || r.vad.silenceMs >= TAIL_QUIET_MS) return;
    await new Promise((done) => setTimeout(done, TAIL_TICK_MS));
  }
}

/** Stops listening, transcribes, and inserts where the focus was when it started */
export async function stopDictation(by: DictationStopReason): Promise<void> {
  const r = run;
  if (!r || store().phase === "transcribing") return;
  if (!r.sessionId) {
    // Released or pressed again while the mic was opening: stop once it listens
    r.stopWhenReady = by;
    return;
  }
  const sessionId = r.sessionId;
  // Transcribing from here: a second Enter or chord meanwhile is swallowed, one insert only
  store().set({ phase: "transcribing", autoInsertCountdown: null });
  await tailQuiet(r);
  if (run !== r) return;
  const durationMs = recordedMs(store());
  // The last words are still in the worklet or in flight: they reach main before the stop does
  await r.capture?.drain();
  if (run !== r) return;
  r.capture?.stop();
  r.capture = null;
  r.cancelled = true;
  const inputName = store().inputName;
  if (isFlat(r.peak)) {
    void trpcMutate("dictation.cancel", { sessionId, source: "flat" });
    reset();
    heardNothing(inputName);
    return;
  }
  if (!r.vad.heard) {
    void trpcMutate("dictation.cancel", { sessionId, source: "nothing-heard" });
    reset();
    toast().addToast({ type: "info", title: "Nothing was heard", body: "Dictation stopped" });
    return;
  }
  const target = finalTarget(r);
  try {
    // Main returns it cleaned (sanitized, repeats collapsed, spoken punctuation)
    const { text } = await trpcMutate<{ text: string }>("dictation.stop", {
      sessionId,
      durationMs,
      projectId: target.projectId,
      targetKind: target.kind,
      by,
    });
    // Esc while transcribing: cancelled for real, nothing is inserted
    if (run !== r) return;
    reset();
    if (!text) {
      heardNothing(inputName);
      return;
    }
    // An auto insert never sends: the user did not choose the moment
    await insertDictation(text, target, by !== "silence" && r.settings.pressEnter, r.field);
  } catch (err) {
    if (run === r) fail(errorText(err));
  }
}

export function cancelDictation(source: DictationCancelSource): void {
  const r = run;
  if (r) {
    r.cancelled = true;
    if (r.sessionId) void trpcMutate("dictation.cancel", { sessionId: r.sessionId, source });
  }
  reset();
}

/** Main's focus relay. Leaving Exegol never cancels: the user may narrate another app and come
 *  back to insert. A held chord's release is lost out there, so the press stops being a hold:
 *  the recording goes on until the next chord press, Enter on the target, or the overlay */
export function appFocusChanged(focused: boolean): void {
  if (!focused) holdCandidate = false;
}

/** Enter inserts only while the start target still has the focus; elsewhere it is that pane's */
export function focusOnTarget(): boolean {
  return !!run && finalTarget(run) === run.target;
}

/** Main's longest-dictation timer fired (main's, so a background window cannot delay it) */
export function dictationLimitReached(sessionId: string, maxSeconds: number): void {
  if (!run || run.sessionId !== sessionId) return;
  toast().addToast({
    type: "info",
    title: "Longest dictation reached",
    body: `Stopped at ${Math.round(maxSeconds / 60)} min (Settings > Dictation)`,
  });
  void stopDictation("limit");
}

/** The shortcut went down: start, or stop a running dictation */
export function chordDown(): void {
  const { phase } = store();
  if (phase === "listening" || phase === "starting") {
    holdCandidate = false;
    void stopDictation("chord");
    return;
  }
  if (phase === "transcribing") {
    window.api.reportError?.("dictation", "start ignored: phase=transcribing", "");
    return;
  }
  pressedAt = Date.now();
  holdCandidate = true;
  void startDictation();
}

/** The shortcut came up: after a long press that was hold-to-talk, so stop */
export function chordUp(): void {
  if (!holdCandidate) return;
  holdCandidate = false;
  if (Date.now() - pressedAt >= HOLD_MS && run) void stopDictation("chord");
}

/** Pause or resume a listening dictation: same session, target and text. The mic stays open so
 *  resuming is instant (reopening it would need main to arm getUserMedia again) */
export function togglePauseDictation(): void {
  const r = run;
  const { phase, pausedAt, startedAt } = store();
  if (!r?.sessionId || phase !== "listening") return;
  const now = Date.now();
  r.paused = !r.paused;
  if (r.paused) store().set({ pausedAt: now, autoInsertCountdown: null });
  else {
    r.vad = resumedVad(r.vad);
    store().set({ pausedAt: null, startedAt: startedAt + (now - (pausedAt ?? now)) });
  }
  void trpcMutate("dictation.pause", { sessionId: r.sessionId, paused: r.paused });
}

/** Status bar mic: a plain toggle */
export function toggleDictation(): void {
  if (run) void stopDictation("mic");
  else if (store().phase !== "transcribing") void startDictation();
}

/** Esc, Close, Cancel: whatever the phase, nothing gets inserted */
export function dismissDictation(source: DictationCancelSource): void {
  const { phase, downloadRequested } = store();
  if (phase === "no-model" && downloadRequested) {
    toast().addToast({
      type: "info",
      title: "The download continues",
      body: "Follow it in Settings > Models",
    });
  }
  const kept = run ? keptOnCancel(run.vad.speechMs, sanitizeDictation(store().partial)) : null;
  if (run) cancelDictation(source);
  else reset();
  // Long speech is not thrown away by one stray Esc
  if (kept) void copyInstead(kept, "Dictation cancelled, text copied", "Paste it if you need it");
}

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err));
