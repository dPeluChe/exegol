import type { IDisposable, Terminal } from "@xterm/xterm";

/** A TUI copy this soon after the user's own click or key is theirs; older ones (a replayed
 *  snapshot, a CLI writing the clipboard by itself) offer nothing */
const GESTURE_MS = 2_000;
const MAX_CHARS = 1_000_000;

/** `OSC 52 ; <targets> ; <base64>` payload as text; null for a query (`?`), a clear or bad data */
export function parseOsc52(data: string): string | null {
  const semi = data.indexOf(";");
  if (semi === -1) return null;
  const b64 = data.slice(semi + 1).trim();
  if (!b64 || b64 === "?" || b64.length > MAX_CHARS * 2) return null;
  try {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return text.length > 0 && text.length <= MAX_CHARS ? text : null;
  } catch {
    return null;
  }
}

/** A TUI that selects with the mouse itself (Claude Code, opencode) copies through OSC 52 and
 *  xterm never holds a selection: hand that text to Send to when the user just made it */
export function watchTuiCopy(
  terminal: Terminal,
  element: HTMLElement,
  onCopy: (text: string) => void,
): IDisposable {
  let lastGestureAt = 0;
  const gesture = () => {
    lastGestureAt = Date.now();
  };
  const events = ["mouseup", "keydown"] as const;
  for (const name of events) element.addEventListener(name, gesture, true);
  const osc = terminal.parser.registerOscHandler(52, (data) => {
    if (Date.now() - lastGestureAt > GESTURE_MS) return true;
    const text = parseOsc52(data);
    if (text) onCopy(text);
    return true;
  });
  return {
    dispose: () => {
      for (const name of events) element.removeEventListener(name, gesture, true);
      osc.dispose();
    },
  };
}
