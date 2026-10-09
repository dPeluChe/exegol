import {
  DICTATION_SAMPLE_RATE,
  type DictationCancelSource,
  type DictationSettings,
  type DictationStatus,
  type DictationStopReason,
  dictationSettingsOf,
  type ScreenDialog,
  type Settings,
} from "@exegol/shared";
import type { QueryClient } from "@tanstack/react-query";
import { DICTATION_STATUS_KEY, fetchDictationStatus } from "../../hooks/use-trpc-dictation";
import { findAgentPane, useAgentStore } from "../../stores/agents";
import { useAppStore } from "../../stores/app";
import { useDictationStore } from "../../stores/dictation";
import { useToastStore } from "../../stores/toasts";
import { getActivePaneId, useWorkspaceStore } from "../../stores/workspace";
import { pasteToAgent, submitToAgent } from "../agent-input";
import { isClaudeQuestion } from "../claude-question";
import { focusedField } from "../focused-field";
import { paneRoot } from "../pane-focus";
import { trpcInvoke, trpcMutate } from "../trpc-client";
import { type Capture, startCapture } from "./capture";
import { insertIntoEditorIn } from "./editors";
import {
  answersPrompt,
  confirmTarget,
  type DictationTarget,
  type FocusSnapshot,
  keptOnCancel,
  resolveTarget,
  sanitizeDictation,
  takesDictation,
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
  cancelled: boolean;
  /** Stopped while the mic was opening: stops once it listens, for this reason */
  stopWhenReady: DictationStopReason | null;
}

let run: Run | null = null;
let pressedAt = 0;
let holdCandidate = false;
let queryClient: QueryClient | null = null;

/** The app's query cache: settings and dictation status are read and written there */
export function bindDictationQueries(client: QueryClient | null): void {
  queryClient = client;
}

export const currentAnalyser = (): AnalyserNode | null => run?.capture?.analyser ?? null;

const store = () => useDictationStore.getState();
const toast = useToastStore.getState;

/** Dashboard: the watched session whose mirror has the focus, and its pane in its project */
function focusedMirror(): FocusSnapshot["mirror"] {
  const card = document.activeElement?.closest<HTMLElement>("[data-mirror-agent-id]");
  const agentId = card?.dataset.mirrorAgentId;
  const agent = agentId ? useAgentStore.getState().agents[agentId] : undefined;
  if (!agentId || !agent) return undefined;
  return {
    agentId,
    projectId: agent.projectId,
    paneId: findAgentPane(agentId, agent.projectId)?.paneId ?? null,
    live: takesDictation(agent),
  };
}

function snapshot(): { target: DictationTarget; field: HTMLElement | null; anchor: string | null } {
  const projectId = useAppStore.getState().activeProjectId;
  const { focusedPaneId, projectWorkspaces } = useWorkspaceStore.getState();
  // Only a pane of the tab on screen: resolveTarget sends anything else to the clipboard
  const activePane = getActivePaneId();
  const pane =
    projectId && activePane ? projectWorkspaces[projectId]?.panes[activePane] : undefined;
  const agent = pane?.agentId ? useAgentStore.getState().agents[pane.agentId] : undefined;
  const field = focusedField();
  const snap: FocusSnapshot = {
    activeView: useAppStore.getState().activeView,
    projectId,
    focusedPaneId,
    pane,
    sessionLive: !!agent && takesDictation(agent),
    editableField: !!field,
    mirror: focusedMirror(),
  };
  const target = resolveTarget(snap);
  // A field inside a pane (the browser's address bar): the overlay still centers on the pane
  const fieldPane = field?.closest<HTMLElement>("[data-pane-id]")?.dataset.paneId ?? null;
  const anchor = "paneId" in target && snap.activeView === "workspace" ? target.paneId : fieldPane;
  return { target, field, anchor };
}

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
  });
}

function fail(message: string): void {
  finishRun();
  store().set({ phase: "error", error: message, sessionId: null });
}

function onChunk(samples: Float32Array): void {
  const r = run;
  if (!r || r.cancelled) return;
  r.vad = updateVad(r.vad, rms(samples), (samples.length / DICTATION_SAMPLE_RATE) * 1000);
  if (r.sessionId) window.api.dictation.sendAudio(r.sessionId, samples);
  else r.early.push(samples);
  if (shouldAutoStop(r.vad, r.settings.autoStopSilenceSec)) void stopDictation("silence");
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
  if (run || store().phase === "transcribing") return;
  const { target, field, anchor } = snapshot();
  store().set({
    phase: "starting",
    anchorPaneId: anchor,
    targetKind: target.kind,
    targetAgentId: "agentId" in target ? target.agentId : null,
    targetProjectId: target.projectId,
    partial: "",
    error: null,
  });
  const current: Run = {
    settings: dictationSettingsOf(undefined),
    target,
    field,
    capture: null,
    sessionId: null,
    early: [],
    vad: VAD_START,
    cancelled: false,
    stopWhenReady: null,
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
    if (!status.engineAvailable) return reset();
    if (!current.settings.enabled) throw new Error("Dictation is off in Settings > Dictation");
    if (!status.model.ready) return endWith({ phase: "no-model" });
    trpcMutate("dictation.warm").catch(() => {});
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
    const started = await trpcMutate<{ sessionId: string }>("dictation.start");
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
  const durationMs = Date.now() - store().startedAt;
  r.capture?.stop();
  r.capture = null;
  r.cancelled = true;
  if (!r.vad.heard) {
    void trpcMutate("dictation.cancel", { sessionId, source: "nothing-heard" });
    reset();
    toast().addToast({ type: "info", title: "Nothing was heard", body: "Dictation stopped" });
    return;
  }
  store().set({ phase: "transcribing" });
  const target = finalTarget(r);
  try {
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
    const clean = sanitizeDictation(text);
    if (!clean) {
      toast().addToast({ type: "info", title: "No words recognized" });
      return;
    }
    await insertDictation(clean, target, r.settings.pressEnter, r.field);
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

/** The start target if the focus never left it and it can still take text */
function finalTarget(r: Run): DictationTarget {
  const target = confirmTarget(r.target, snapshot().target);
  if (target.kind === "field" && (!r.field?.isConnected || document.activeElement !== r.field)) {
    return { kind: "clipboard", projectId: target.projectId, why: "The field lost the focus" };
  }
  return target;
}

async function copyInstead(text: string, title: string, body: string): Promise<void> {
  await navigator.clipboard.writeText(text).catch(() => {});
  toast().addToast({ type: "info", title, body });
}

/** Why the text must not be typed into the agent: it ended, or a dictation would answer its
 *  question. Null when it can take it */
async function terminalRefusal(agentId: string): Promise<string | null> {
  const { agents, attentionItems } = useAgentStore.getState();
  const agent = agents[agentId];
  if (!agent || !takesDictation(agent)) return "The agent is not running";
  if (agent.cliType === "shell") return null;
  const dialog = await trpcInvoke<ScreenDialog | null>("agents.screenDialog", {
    id: agentId,
  }).catch(() => null);
  const asks = answersPrompt({
    status: agent.status,
    dialogOnScreen: !!dialog,
    // Claude's hooks say when it asks; other CLIs' prompts show up as a screen dialog
    awaitingAnswer: isClaudeQuestion(attentionItems[agentId], agent),
  });
  return asks ? "The agent is waiting on a question" : null;
}

export async function insertDictation(
  text: string,
  target: DictationTarget,
  pressEnter: boolean,
  field: HTMLElement | null,
): Promise<void> {
  if (target.kind === "terminal") {
    const refusal = await terminalRefusal(target.agentId);
    if (refusal) {
      return copyInstead(text, "Dictation copied, not typed", `${refusal}: paste it yourself`);
    }
    if (pressEnter) submitToAgent(target.agentId, text, true);
    else pasteToAgent(target.agentId, text, true);
    return;
  }
  if (target.kind === "browser") {
    const ok = await window.api.dictation
      .insertInBrowser({ paneId: target.paneId, projectId: target.projectId, text })
      .catch(() => false);
    if (ok) return;
    return copyInstead(
      text,
      "Dictation copied",
      "The page changed, is outside the project's hosts, or no editable field has the focus",
    );
  }
  if (target.kind === "editor") {
    const root = paneRoot(target.paneId);
    if (root && insertIntoEditorIn(root, text)) return;
  }
  if (target.kind === "field" && field) {
    field.focus();
    if (document.execCommand("insertText", false, text)) return;
  }
  const why = target.kind === "clipboard" ? target.why : undefined;
  return copyInstead(
    text,
    "Dictation copied",
    why
      ? `${why}: paste it where you need it`
      : "No focused pane could take it: paste it where you need it",
  );
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
  if (phase === "transcribing") return;
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
