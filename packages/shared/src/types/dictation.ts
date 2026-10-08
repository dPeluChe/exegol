/** Local voice dictation (T201 phase 2): settings, status, history and the shortcut chord */

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

/** Where a dictation went: a pane kind, a text field of the app, or the clipboard */
export const DICTATION_TARGET_KINDS = [
  "terminal",
  "browser",
  "editor",
  "field",
  "clipboard",
] as const;

export type DictationTargetKind = (typeof DICTATION_TARGET_KINDS)[number];

export interface DictationSettings {
  enabled: boolean;
  /** macOS notation ("Cmd+Shift+Space"); Cmd reads as Ctrl on Linux and Windows */
  shortcut: string;
  /** Press Enter after inserting into a terminal */
  pressEnter: boolean;
  /** The loaded model is freed after this long without a dictation */
  idleUnloadMinutes: number;
  maxSeconds: number;
  /** Stop on its own after this much silence once speech was heard; 0 = off */
  autoStopSilenceSec: number;
  retentionDays: number;
  retentionMax: number;
}

export const DEFAULT_DICTATION_SHORTCUT = "Cmd+Shift+Space";

export const DEFAULT_DICTATION_SETTINGS: DictationSettings = {
  enabled: true,
  shortcut: DEFAULT_DICTATION_SHORTCUT,
  pressEnter: false,
  idleUnloadMinutes: 10,
  maxSeconds: 300,
  autoStopSilenceSec: 0,
  retentionDays: 30,
  retentionMax: 500,
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
