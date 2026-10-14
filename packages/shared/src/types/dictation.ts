/** Local voice dictation (T201 phase 2): settings, status, history and the shortcut chord */

import { applySpokenPunctuation } from "./dictation-punctuation";

/** Mic audio is resampled to this before it leaves the renderer; every model takes it */
export const DICTATION_SAMPLE_RATE = 16_000;

/** Energy voice detection: enough to tell "nothing was said" and to stop after a pause. Mic
 *  capture runs with auto gain, so speech sits well above this RMS and room noise below it */
export const SPEECH_RMS = 0.008;
export function rms(samples: Float32Array): number {
  if (samples.length === 0) return 0;
  let sum = 0;
  for (const s of samples) sum += s * s;
  return Math.sqrt(sum / samples.length);
}

/** Dictated text is data: no escape sequences or control characters reach a terminal (one
 *  could end a bracketed paste and run the rest) */
export function sanitizeDictation(text: string): string {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: stripping them is the point
  return text.replace(/[\u0000-\u0009\u000b-\u001f\u007f-\u009f]/g, "").trim();
}

/** What a dictation inserts: sanitized, then spoken punctuation when it is on */
export function cleanDictation(text: string, opts: { spokenPunctuation: boolean }): string {
  const clean = sanitizeDictation(text);
  return opts.spokenPunctuation ? applySpokenPunctuation(clean) : clean;
}

export const DICTATION_VOCABULARY_MAX = 200;
export const DICTATION_TERM_MAX = 64;
/** hotwordsScore in sherpa-onnx: added per matched token while decoding */
export const DICTATION_VOCABULARY_BOOSTS = [1.5, 3, 5] as const;

/** One term per line. Commas, slashes and colons are the engines' separators: they become spaces */
export function parseVocabulary(text: string | readonly string[]): string[] {
  const lines = typeof text === "string" ? text.split("\n") : text;
  const seen = new Set<string>();
  const out: string[] = [];
  for (const line of lines) {
    const term = line
      // biome-ignore lint/suspicious/noControlCharactersInRegex: terms go into engine files
      .replace(/[\u0000-\u001f\u007f-\u009f,/:]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, DICTATION_TERM_MAX)
      .trim();
    if (!term || seen.has(term)) continue;
    seen.add(term);
    out.push(term);
    if (out.length >= DICTATION_VOCABULARY_MAX) break;
  }
  return out;
}

/** The global list plus the project's own terms, capped together */
export function dictationVocabulary(
  settings: Pick<DictationSettings, "vocabulary" | "projectVocabulary">,
  projectId: string | null,
): string[] {
  const own = projectId ? (settings.projectVocabulary[projectId] ?? []) : [];
  return parseVocabulary([...settings.vocabulary, ...own]);
}

/** Where a dictation went: a pane kind, a text field of the app, or the clipboard */
export const DICTATION_TARGET_KINDS = [
  "terminal",
  "browser",
  "editor",
  "field",
  "clipboard",
] as const;

export type DictationTargetKind = (typeof DICTATION_TARGET_KINDS)[number];

/** Where the overlay sits: over the target pane (docked to the title bar while that pane is not
 *  on screen), or always docked at the top center */
export const DICTATION_OVERLAY_POSITIONS = ["pane", "titlebar"] as const;
export type DictationOverlayPosition = (typeof DICTATION_OVERLAY_POSITIONS)[number];

/** The spoken language, for models that need one (Canary); multilingual models detect it.
 *  A new language is one entry here */
export const DICTATION_LANGUAGES = [
  { id: "en", label: "English" },
  { id: "es", label: "Spanish" },
] as const;
export type DictationLanguage = (typeof DICTATION_LANGUAGES)[number]["id"];
export const DICTATION_LANGUAGE_IDS = DICTATION_LANGUAGES.map((l) => l.id) as [
  DictationLanguage,
  ...DictationLanguage[],
];

/** What ended a dictation, for the log line (never the text): a bug report tells a mis-click from
 *  a key that never arrived */
export const DICTATION_STOP_REASONS = [
  "chord",
  "enter",
  "button",
  "mic",
  "limit",
  "silence",
] as const;
export type DictationStopReason = (typeof DICTATION_STOP_REASONS)[number];

/** `esc-forwarded`: Esc main forwarded from a page or another Exegol window */
export const DICTATION_CANCEL_SOURCES = [
  "esc",
  "esc-forwarded",
  "button",
  "nothing-heard",
  "superseded",
  "disabled",
] as const;
export type DictationCancelSource = (typeof DICTATION_CANCEL_SOURCES)[number];

/** Which mic a dictation opened, for the log: the selected one fell back when it was missing */
export const DICTATION_INPUTS = ["default", "selected", "fallback"] as const;
export type DictationInput = (typeof DICTATION_INPUTS)[number];

/** Pause or resume a running dictation: Cmd+P on macOS, Ctrl+Shift+P elsewhere (the app chord:
 *  plain Ctrl+P is the terminal's) */
export function isDictationPauseKey(
  e: { metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean; code?: string },
  mac: boolean,
): boolean {
  if (e.code !== "KeyP" || e.altKey) return false;
  return mac ? e.metaKey && !e.ctrlKey && !e.shiftKey : e.ctrlKey && e.shiftKey && !e.metaKey;
}

/** Days a kept recording (audio + its text, Settings > Dictation) stays on disk */
export const DICTATION_RECORDING_RETENTION_DAYS = [5, 10, 15, 30] as const;
export type DictationRecordingRetentionDays = (typeof DICTATION_RECORDING_RETENTION_DAYS)[number];

export interface DictationSettings {
  enabled: boolean;
  /** macOS notation ("Cmd+Shift+Space"); Cmd reads as Ctrl on Linux and Windows */
  shortcut: string;
  /** Press Enter after inserting into a terminal */
  pressEnter: boolean;
  /** Pause what is playing while a dictation records, resume it after */
  pauseMedia: boolean;
  /** macOS: also control Music and Spotify over Apple Events when system Now Playing cannot
   *  (asks for Automation access per app) */
  pauseMediaDirect: boolean;
  /** The loaded model is freed after this long without a dictation */
  idleUnloadMinutes: number;
  maxSeconds: number;
  /** Stop on its own after this much silence once speech was heard; 0 = off */
  autoStopSilenceSec: number;
  retentionDays: number;
  retentionMax: number;
  overlayPosition: DictationOverlayPosition;
  /** Save each dictation's audio and text under ~/.exegol/dictation-audio, to compare models */
  keepRecordings: boolean;
  recordingsRetentionDays: DictationRecordingRetentionDays;
  /** The mic to open (a getUserMedia deviceId); null = the system default */
  inputDeviceId: string | null;
  /** Its label when it was picked, for the "not found" notice once it is gone */
  inputDeviceLabel: string | null;
  /** Terms to bias recognition toward (models that support it), and each project's additions */
  vocabulary: string[];
  projectVocabulary: Record<string, string[]>;
  vocabularyBoost: number;
  /** "coma", "new line"... become punctuation (Spanish and English) */
  spokenPunctuation: boolean;
  language: DictationLanguage;
}

export const DEFAULT_DICTATION_SHORTCUT = "Cmd+Shift+Space";

export const DEFAULT_DICTATION_SETTINGS: DictationSettings = {
  enabled: true,
  shortcut: DEFAULT_DICTATION_SHORTCUT,
  pressEnter: false,
  pauseMedia: true,
  pauseMediaDirect: false,
  idleUnloadMinutes: 10,
  maxSeconds: 300,
  autoStopSilenceSec: 0,
  retentionDays: 30,
  retentionMax: 500,
  overlayPosition: "pane",
  keepRecordings: false,
  recordingsRetentionDays: 10,
  inputDeviceId: null,
  inputDeviceLabel: null,
  vocabulary: [],
  projectVocabulary: {},
  vocabularyBoost: 3,
  spokenPunctuation: true,
  language: "en",
};

/** The saved settings over the defaults: a row written before a field existed lacks it */
export function dictationSettingsOf(
  saved: Partial<DictationSettings> | undefined,
): DictationSettings {
  return { ...DEFAULT_DICTATION_SETTINGS, ...saved };
}

/** Electron's getMediaAccessStatus values, plus "unknown" where the OS does not say */
export type MicStatus = "granted" | "denied" | "restricted" | "not-determined" | "unknown";

export type DictationEngineState = "unloaded" | "loading" | "ready" | "failed";

export interface DictationStatus {
  platform: string;
  mic: MicStatus;
  /** macOS granted once, or a dictation was recorded here before */
  micEverGranted: boolean;
  /** The model a dictation would use: the default when installed, else the first installed */
  model: {
    id: string;
    name: string;
    kind: "offline" | "streaming";
    ready: boolean;
    sizeBytes: number;
    /** Its recognizer takes the vocabulary (Settings > Dictation) */
    vocabulary: boolean;
  };
  engine: DictationEngineState;
  /** The speech engine (a native addon) loads on this system; checked once in its process */
  engineAvailable: boolean;
  /** Why it does not, for Settings > Dictation */
  engineError: string | null;
}

export interface DictationHistoryItem {
  id: string;
  text: string;
  modelId: string;
  durationMs: number;
  createdAt: number;
  projectId: string | null;
  targetKind: DictationTargetKind;
}

/** Kept recordings on disk: a recording is its .wav and .json, counted once */
export interface DictationRecordingsSummary {
  count: number;
  bytes: number;
  projects: {
    projectId: string | null;
    projectName: string | null;
    count: number;
    bytes: number;
  }[];
}

/** Pushed on `dictation:partial` while a streaming model listens */
export interface DictationPartialEvent {
  sessionId: string;
  text: string;
}

/** A keyboard chord: Cmd is the app modifier (Ctrl off macOS), `ctrl` is the macOS Control key */
export interface KeyChord {
  cmd: boolean;
  ctrl: boolean;
  shift: boolean;
  alt: boolean;
  /** KeyboardEvent.code: "Space", "KeyD", "Digit1", "F5" */
  code: string;
}

const NAMED_CODES = new Set([
  "Space",
  "Backquote",
  "Minus",
  "Equal",
  "BracketLeft",
  "BracketRight",
  "Backslash",
  "Semicolon",
  "Quote",
  "Comma",
  "Period",
  "Slash",
]);

function keyToCode(key: string): string | null {
  if (/^[A-Z]$/i.test(key)) return `Key${key.toUpperCase()}`;
  if (/^[0-9]$/.test(key)) return `Digit${key}`;
  if (/^F([1-9]|1[0-9]|2[0-4])$/.test(key)) return key;
  return NAMED_CODES.has(key) ? key : null;
}

function codeToKey(code: string): string | null {
  const letter = /^Key([A-Z])$/.exec(code)?.[1];
  if (letter) return letter;
  const digit = /^Digit([0-9])$/.exec(code)?.[1];
  if (digit) return digit;
  return keyToCode(code) === code ? code : null;
}

/** "Cmd+Shift+Space" → chord; null unless it has Cmd or Ctrl and one known key */
export function parseChord(text: string): KeyChord | null {
  const parts = text.split("+").map((p) => p.trim());
  const key = parts.pop();
  if (!key) return null;
  const chord: KeyChord = { cmd: false, ctrl: false, shift: false, alt: false, code: "" };
  for (const mod of parts) {
    if (mod === "Cmd") chord.cmd = true;
    else if (mod === "Ctrl") chord.ctrl = true;
    else if (mod === "Shift") chord.shift = true;
    else if (mod === "Option" || mod === "Alt") chord.alt = true;
    else return null;
  }
  const code = keyToCode(key);
  if (!code || !(chord.cmd || chord.ctrl)) return null;
  chord.code = code;
  return chord;
}

/** The chord as the running platform writes it: "Cmd+Shift+Space", or "Ctrl+Shift+Space" */
export function formatChord(chord: KeyChord, mac: boolean): string {
  const mods: string[] = [];
  if (mac) {
    if (chord.ctrl) mods.push("Ctrl");
    if (chord.cmd) mods.push("Cmd");
  } else if (chord.cmd || chord.ctrl) {
    mods.push("Ctrl");
  }
  if (chord.alt) mods.push(mac ? "Option" : "Alt");
  if (chord.shift) mods.push("Shift");
  return [...mods, codeToKey(chord.code) ?? chord.code].join("+");
}

interface ChordInput {
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  code: string;
}

/** The key event is the chord. Off macOS, Cmd (and Ctrl) is the Ctrl key and Meta must be up */
export function matchesChord(e: ChordInput, chord: KeyChord, mac: boolean): boolean {
  if (e.code !== chord.code || e.shiftKey !== chord.shift || e.altKey !== chord.alt) return false;
  if (mac) return e.metaKey === chord.cmd && e.ctrlKey === chord.ctrl;
  return !e.metaKey && e.ctrlKey;
}

/** A pressed key combination in stored (macOS) notation, for the shortcut recorder. Off macOS
 *  Ctrl is stored as Cmd so the same setting works on every platform */
export function chordFromEvent(e: ChordInput, mac: boolean): string | null {
  const key = codeToKey(e.code);
  if (!key) return null;
  const mods: string[] = [];
  if (mac) {
    if (e.ctrlKey) mods.push("Ctrl");
    if (e.metaKey) mods.push("Cmd");
  } else {
    if (e.metaKey) return null;
    if (e.ctrlKey) mods.push("Cmd");
  }
  if (e.altKey) mods.push("Option");
  if (e.shiftKey) mods.push("Shift");
  const text = [...mods, key].join("+");
  return parseChord(text) ? text : null;
}

const MODIFIER_KEYS: Record<string, keyof KeyChord> = {
  Meta: "cmd",
  Control: "ctrl",
  Shift: "shift",
  Alt: "alt",
};

/** A key-up that ends a held chord: its key, or one of its modifiers */
export function releasesChord(e: { key: string; code: string }, chord: KeyChord, mac: boolean) {
  if (e.code === chord.code) return true;
  const flag = MODIFIER_KEYS[e.key];
  if (!flag) return false;
  if (!mac && e.key === "Control") return chord.cmd || chord.ctrl;
  return chord[flag] === true;
}
