import { hostOf } from "../types/agent-browser";

export type ZoomAction = "in" | "out" | "reset";

/** Chrome's zoom levels */
export const ZOOM_STEPS = [
  0.25, 0.33, 0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3,
] as const;

const MIN_ZOOM = 0.25;
const MAX_ZOOM = 3;
const EPSILON = 0.001;

/** The next zoom factor; a factor between two steps goes to the nearer one in that direction */
export function stepZoom(current: number, action: ZoomAction): number {
  if (action === "reset") return 1;
  if (action === "in") return ZOOM_STEPS.find((s) => s > current + EPSILON) ?? MAX_ZOOM;
  return [...ZOOM_STEPS].reverse().find((s) => s < current - EPSILON) ?? MIN_ZOOM;
}

export const zoomPercent = (factor: number): number => Math.round(factor * 100);

interface ZoomKeyInput {
  meta: boolean;
  control: boolean;
  shift: boolean;
  alt: boolean;
  code: string;
  key: string;
}

/** The browser pane zoom a key press asks for: Cmd+= / Cmd+- / Cmd+0 on macOS, Ctrl+Shift+ the
 *  same keys elsewhere (the app chord, lib/keymap). Cmd+Shift+0 stays the app's Reset Zoom */
export function paneZoomKey(input: ZoomKeyInput, mac: boolean): ZoomAction | null {
  const chord = mac
    ? input.meta && !input.control && !input.alt
    : input.control && input.shift && !input.meta && !input.alt;
  if (!chord) return null;
  const { code, key } = input;
  if (code === "Equal" || code === "NumpadAdd" || key === "+" || key === "=") return "in";
  if (code === "Minus" || code === "NumpadSubtract" || key === "-" || key === "_") return "out";
  if ((code === "Digit0" || code === "Numpad0") && !(mac && input.shift)) return "reset";
  return null;
}

const pad = (n: number) => String(n).padStart(2, "0");

/** `<host>-<yyyy-mm-dd-hhmm>.<ext>` in local time; never the path or query of the page */
export function screenshotFileName(url: string, date: Date, ext: "png" | "jpg" = "png"): string {
  const host = (hostOf(url) ?? "").replace(/[^A-Za-z0-9.-]+/g, "-").replace(/^-+|-+$/g, "");
  const name = host || "page";
  const day = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  return `${name}-${day}-${pad(date.getHours())}${pad(date.getMinutes())}.${ext}`;
}
