import {
  type DictationSettings,
  type DictationStatus,
  dictationSettingsOf,
  LIVE_STATUSES,
  type Settings,
} from "@exegol/shared";
import { useAgentStore } from "../../stores/agents";
import { useAppStore } from "../../stores/app";
import { useDictationStore } from "../../stores/dictation";
import { useToastStore } from "../../stores/toasts";
import { useWorkspaceStore } from "../../stores/workspace";
import { pasteToAgent } from "../agent-input";
import { trpcInvoke, trpcMutate } from "../trpc-client";
import { type Capture, startCapture } from "./capture";
import { insertIntoEditorIn } from "./editors";
import {
  confirmTarget,
  type DictationTarget,
  type FocusSnapshot,
  resolveTarget,
  sanitizeDictation,
} from "./target";
import { rms, shouldAutoStop, updateVad, VAD_START, type VadState } from "./vad";

/** A press held at least this long is hold-to-talk (release stops); shorter toggles */
const HOLD_MS = 350;

interface Run {
  settings: DictationSettings;
  target: DictationTarget;
  /** The app's own text field that had the focus, when that is the target */
  field: HTMLElement | null;
  capture: Capture | null;
  sessionId: string | null;
  /** Chunks captured before the session id came back */
  early: Float32Array[];
  vad: VadState;
  maxTimer: ReturnType<typeof setTimeout> | null;
  cancelled: boolean;
  stopWhenReady: boolean;
}

let run: Run | null = null;
let pressedAt = 0;
let holdCandidate = false;

export const currentAnalyser = (): AnalyserNode | null => run?.capture?.analyser ?? null;

const store = () => useDictationStore.getState();
const toast = useToastStore.getState;

/** The app's own text input with the focus (not a terminal's or Monaco's hidden textarea) */
function focusedField(): HTMLElement | null {
  const el = document.activeElement;
  if (!(el instanceof HTMLElement) || el.closest(".xterm, .monaco-editor")) return null;
  if (el instanceof HTMLTextAreaElement) return el.readOnly || el.disabled ? null : el;
  if (el instanceof HTMLInputElement) {
    const textual = ["text", "search", "url", "email", ""].includes(el.type);
    return textual && !el.readOnly && !el.disabled ? el : null;
  }
  return el.isContentEditable ? el : null;
}

function snapshot(): { target: DictationTarget; field: HTMLElement | null } {
  const projectId = useAppStore.getState().activeProjectId;
  const { focusedPaneId, projectWorkspaces } = useWorkspaceStore.getState();
  const pane =
    projectId && focusedPaneId ? projectWorkspaces[projectId]?.panes[focusedPaneId] : undefined;
  const agent = pane?.agentId ? useAgentStore.getState().agents[pane.agentId] : undefined;
  const field = focusedField();
  const snap: FocusSnapshot = {
    activeView: useAppStore.getState().activeView,
    projectId,
    focusedPaneId,
    pane,
    sessionLive: !!agent && LIVE_STATUSES.has(agent.status),
    editableField: !!field,
  };
  return { target: resolveTarget(snap), field };
}

function paneRoot(paneId: string): Element | null {
  return document.querySelector(`[data-pane-id="${CSS.escape(paneId)}"]`);
}

function finishRun(): void {
  if (!run) return;
  if (run.maxTimer) clearTimeout(run.maxTimer);
  run.capture?.stop();
  run = null;
}

function reset(): void {
  finishRun();
  holdCandidate = false;
  store().set({ phase: "idle", sessionId: null, partial: "", error: null, anchorPaneId: null });
}

function fail(message: string): void {
  finishRun();
  store().set({ phase: "error", error: message, sessionId: null });
}

function onChunk(samples: Float32Array): void {
  const r = run;
  if (!r || r.cancelled) return;
  r.vad = updateVad(r.vad, rms(samples), (samples.length / 16_000) * 1000);
  if (r.sessionId) window.api.dictation.sendAudio(r.sessionId, samples);
  else r.early.push(samples);
  if (shouldAutoStop(r.vad, r.settings.autoStopSilenceSec)) void stopDictation();
}

async function loadStatus(): Promise<DictationStatus> {
  const status = await trpcInvoke<DictationStatus>("dictation.status");
  store().set({ status });
  return status;
}

export async function startDictation(): Promise<void> {
  if (run || store().phase === "transcribing") return;
  const { target, field } = snapshot();
  const anchorPaneId = "paneId" in target ? target.paneId : null;
  store().set({ phase: "starting", anchorPaneId, partial: "", error: null });
  const current: Run = {
    settings: dictationSettingsOf(undefined),
    target,
    field,
    capture: null,
    sessionId: null,
    early: [],
    vad: VAD_START,
    maxTimer: null,
    cancelled: false,
    stopWhenReady: false,
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
    const [settings, status] = await Promise.all([
      trpcInvoke<Settings>("settings.get"),
      loadStatus(),
    ]);
    if (gone()) return;
    current.settings = dictationSettingsOf(settings.dictation);
    if (!current.settings.enabled) throw new Error("Dictation is off in Settings > Dictation");
    if (!status.model.ready) return endWith({ phase: "no-model" });
    let mic = status.mic;
    if (mic === "not-determined") {
      mic = (await trpcMutate<{ mic: DictationStatus["mic"] }>("dictation.requestMic")).mic;
    }
    if (mic === "denied" || mic === "restricted") return endWith({ phase: "mic-denied" });
    if (gone()) return;
    try {
      current.capture = await startCapture(onChunk);
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
    const started = await trpcMutate<{ sessionId: string; maxSeconds: number }>("dictation.start");
    if (gone()) {
      void trpcMutate("dictation.cancel", { sessionId: started.sessionId });
      return;
    }
    current.sessionId = started.sessionId;
    for (const chunk of current.early.splice(0)) {
      window.api.dictation.sendAudio(started.sessionId, chunk);
    }
    current.maxTimer = setTimeout(() => void stopDictation(), started.maxSeconds * 1000);
    store().set({ phase: "listening", sessionId: started.sessionId, startedAt: Date.now() });
    if (current.stopWhenReady) void stopDictation();
  } catch (err) {
    if (!gone()) fail(errorText(err));
  }
}

/** Stops listening, transcribes, and inserts where the focus was when it started */
export async function stopDictation(): Promise<void> {
  const r = run;
  if (!r || store().phase === "transcribing") return;
  if (!r.sessionId) {
    // Released or pressed again while the mic was opening: stop once it listens
    r.stopWhenReady = true;
    return;
  }
  const sessionId = r.sessionId;
  const durationMs = Date.now() - store().startedAt;
  if (r.maxTimer) clearTimeout(r.maxTimer);
  r.capture?.stop();
  r.capture = null;
  r.cancelled = true;
  if (!r.vad.heard) {
    void trpcMutate("dictation.cancel", { sessionId });
    reset();
    toast().addToast({ type: "info", title: "Nothing was heard", body: "Dictation stopped" });
    return;
  }
  store().set({ phase: "transcribing" });
  const target = await finalTarget(r);
  try {
    const { text } = await trpcMutate<{ text: string }>("dictation.stop", {
      sessionId,
      durationMs,
      projectId: target.projectId,
      targetKind: target.kind,
    });
    reset();
    const clean = sanitizeDictation(text);
    if (!clean) {
      toast().addToast({ type: "info", title: "No words recognized" });
      return;
    }
    await insertDictation(clean, target, r.settings.pressEnter, r.field);
  } catch (err) {
    fail(errorText(err));
  }
}

export function cancelDictation(): void {
  const r = run;
  if (r) {
    r.cancelled = true;
    if (r.sessionId) void trpcMutate("dictation.cancel", { sessionId: r.sessionId });
  }
  reset();
}

/** The start target if the focus never left it and it can still take text */
async function finalTarget(r: Run): Promise<DictationTarget> {
  const target = confirmTarget(r.target, snapshot().target);
  if (target.kind === "field" && (!r.field?.isConnected || document.activeElement !== r.field)) {
    return { kind: "clipboard", projectId: target.projectId };
  }
  return target;
}

export async function insertDictation(
  text: string,
  target: DictationTarget,
  pressEnter: boolean,
  field: HTMLElement | null,
): Promise<void> {
  if (target.kind === "terminal") {
    pasteToAgent(target.agentId, text);
    if (pressEnter) window.api.terminal.write(target.agentId, "\r");
    return;
  }
  if (target.kind === "browser") {
    const ok = await window.api.dictation
      .insertInBrowser({ paneId: target.paneId, projectId: target.projectId, text })
      .catch(() => false);
    if (ok) return;
  }
  if (target.kind === "editor") {
    const root = paneRoot(target.paneId);
    if (root && insertIntoEditorIn(root, text)) return;
  }
  if (target.kind === "field" && field) {
    field.focus();
    if (document.execCommand("insertText", false, text)) return;
  }
  await navigator.clipboard.writeText(text).catch(() => {});
  toast().addToast({
    type: "info",
    title: "Dictation copied",
    body: "No focused pane could take it: paste it where you need it",
  });
}

/** History > Insert (from the Settings window): into whatever has the focus now */
export function insertFromHistory(text: string): void {
  const clean = sanitizeDictation(text);
  if (!clean) return;
  const { target, field } = snapshot();
  void insertDictation(clean, target, false, field);
}

/** The shortcut went down: start, or stop a running dictation */
export function chordDown(): void {
  const { phase } = store();
  if (phase === "listening" || phase === "starting") {
    holdCandidate = false;
    void stopDictation();
    return;
  }
  if (phase === "transcribing") return;
  pressedAt = Date.now();
  holdCandidate = true;
  void startDictation();
}

/** The shortcut came up: after a long press that was hold-to-talk, so stop */
export function chordUp(): void {
  if (!holdCandidate) return;
  holdCandidate = false;
  if (Date.now() - pressedAt >= HOLD_MS && run) void stopDictation();
}

/** Status bar mic: a plain toggle */
export function toggleDictation(): void {
  if (run) void stopDictation();
  else if (store().phase !== "transcribing") void startDictation();
}

export function dismissDictation(): void {
  if (run) cancelDictation();
  else if (store().phase !== "transcribing") reset();
}

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err));
