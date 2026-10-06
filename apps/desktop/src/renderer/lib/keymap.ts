/**
 * The app's modifier per platform. macOS: Cmd. Linux and Windows: Ctrl+Shift, because a focused
 * terminal owns Ctrl+letter (Ctrl+D is EOF, Ctrl+W deletes a word) and the Super key belongs to
 * the desktop. A macOS Shift or Option variant becomes Ctrl+Shift+Alt there.
 * Shortcuts are written once in macOS notation; `appKeys` renders them for the running platform.
 */
export const IS_MAC =
  typeof window === "undefined" || (window.api?.app?.getPlatform?.() ?? "darwin") === "darwin";

interface ChordEvent {
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  key: string;
  code: string;
}

/** The app modifier is held: which macOS extras (Shift, Option) come with it. Null otherwise */
export function appChord(e: ChordEvent, mac = IS_MAC): { shift: boolean; alt: boolean } | null {
  if (mac) return e.metaKey && !e.ctrlKey ? { shift: e.shiftKey, alt: e.altKey } : null;
  return e.ctrlKey && e.shiftKey && !e.metaKey ? { shift: e.altKey, alt: e.altKey } : null;
}

const CODE_KEYS: Record<string, string> = {
  Comma: ",",
  Period: ".",
  Slash: "/",
  BracketLeft: "[",
  BracketRight: "]",
  ArrowDown: "ArrowDown",
};

/** The key of a chord, unaffected by Shift or Option: "d", "2", "]", "," */
export function chordKey(e: ChordEvent): string {
  const digit = /^Digit([0-9])$/.exec(e.code)?.[1];
  if (digit) return digit;
  return CODE_KEYS[e.code] ?? e.key.toLowerCase();
}

const GLYPHS: Record<string, string> = { "⌘": "Cmd+", "⇧": "Shift+", "⌥": "Option+" };

/** An app shortcut for this platform: "Cmd+Shift+D" → "Ctrl+Shift+Alt+D" off macOS. macOS text
 *  (and glyphs like "⌘⇧D") comes back unchanged */
export function appKeys(keys: string, mac = IS_MAC): string {
  if (mac) return keys;
  return keys
    .replace(/[⌘⇧⌥]+/g, (mods) => [...mods].map((m) => GLYPHS[m]).join(""))
    .replace(/Cmd\+((?:Shift|Option)\+)?/g, (_, extra) =>
      extra ? "Ctrl+Shift+Alt+" : "Ctrl+Shift+",
    )
    .replace(/Option\+/g, "Alt+")
    .replace(/↓/g, "Down");
}

/** A text-editing key (Cmd+Enter, Cmd+S, Cmd+click): plain Ctrl off macOS */
export function editKeys(keys: string, mac = IS_MAC): string {
  return mac ? keys : keys.replace(/Cmd\+/g, "Ctrl+");
}

/** The click modifier of `editKeys("Cmd+click")`: Cmd on macOS, plain Ctrl elsewhere */
export function hasClickModifier(e: { metaKey: boolean; ctrlKey: boolean }, mac = IS_MAC): boolean {
  return mac ? e.metaKey : e.ctrlKey;
}

/** A short badge for an app chord plus one key: "⌘2", or "^⇧2" off macOS */
export function chordBadge(key: string, mac = IS_MAC): string {
  return mac ? `⌘${key}` : `^⇧${key}`;
}
