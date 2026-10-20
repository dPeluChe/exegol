export type AppKeyAction =
  | "new-tab"
  | "close-pane"
  | "focus-location"
  | "reload"
  | "reset-zoom"
  | "quit";

interface KeyInput {
  type: string;
  meta: boolean;
  control: boolean;
  shift: boolean;
  alt: boolean;
  key: string;
  code: string;
}

const PAGE_KEYS: Record<string, AppKeyAction> = {
  t: "new-tab",
  w: "close-pane",
  l: "focus-location",
  r: "reload",
  q: "quit",
};

/** The app chord a page in a webview would swallow off macOS, where no menu bar takes it first
 *  (Ctrl+Shift = Cmd, renderer/lib/keymap). macOS: null, its menu accelerators fire in pages */
export function webviewAppKey(input: KeyInput, platform: string): AppKeyAction | null {
  if (platform === "darwin" || input.type !== "keyDown") return null;
  if (!input.control || !input.shift || input.meta) return null;
  if (input.alt) return input.code === "Digit0" || input.code === "Numpad0" ? "reset-zoom" : null;
  return PAGE_KEYS[input.key.toLowerCase()] ?? null;
}
