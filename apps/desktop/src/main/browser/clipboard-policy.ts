/** Clipboard for pages in browser panes, close to Chrome: writes allowed, reads only right after
 *  the user's own click or key in that page, and never while an agent drives it */
export const CLIPBOARD_GESTURE_MS = 5_000;

export interface ClipboardRequest {
  permission: string;
  agentActing: boolean;
  /** ms since the user's last mouse down or key down in the page; null = none yet */
  sinceUserInput: number | null;
}

/** null: not a clipboard permission, the caller decides */
export function allowPageClipboard(r: ClipboardRequest): boolean | null {
  if (r.permission === "clipboard-sanitized-write") return true;
  if (r.permission === "deprecated-sync-clipboard-read") return false;
  if (r.permission !== "clipboard-read") return null;
  return !r.agentActing && r.sinceUserInput !== null && r.sinceUserInput < CLIPBOARD_GESTURE_MS;
}

const USER_INPUT_TYPES = new Set(["mouseDown", "rawKeyDown", "keyDown"]);

export const isUserGesture = (type: unknown): boolean =>
  typeof type === "string" && USER_INPUT_TYPES.has(type);
