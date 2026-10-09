import { type KeyChord, matchesChord, releasesChord } from "@exegol/shared";
import type { WebContents } from "electron";
import { logger } from "../lib/logger";
import { getMainWindow } from "../windows/main-window-ref";

let chord: KeyChord | null = null;
let isListening: () => boolean = () => false;

export function setDictationChord(next: KeyChord | null): void {
  chord = next;
}

export function setDictationListening(check: () => boolean): void {
  isListening = check;
}

export const isPlainEnter = (input: Electron.Input) =>
  input.key === "Enter" &&
  !input.isComposing &&
  !input.meta &&
  !input.control &&
  !input.alt &&
  !input.shift;

const isEscapeDown = (input: Electron.Input) =>
  input.type === "keyDown" && input.key === "Escape" && !input.isComposing;

const hostIsMain = (host: WebContents) => host === getMainWindow()?.webContents;

type ToMain = (event: { kind: "escape" }) => void;
const sendToMain: ToMain = (event) => getMainWindow()?.webContents.send("dictation:key", event);

/** A page in a browser pane keeps its keys: the dictation chord (down and up, for hold-to-talk)
 *  goes to the window hosting it; Enter while a dictation runs only from the main window, the
 *  one with the overlay. Esc cancels from any window: the recording outlives the focus */
export function forwardDictationKeys(
  contents: WebContents,
  isMain = hostIsMain,
  toMain = sendToMain,
): void {
  let held = false;
  contents.on("before-input-event", (event, input) => {
    const host = contents.hostWebContents;
    if (!chord || !host || host.isDestroyed()) return;
    const mac = process.platform === "darwin";
    const keys = {
      metaKey: input.meta,
      ctrlKey: input.control,
      shiftKey: input.shift,
      altKey: input.alt,
      code: input.code,
    };
    if (input.type === "keyDown" && matchesChord(keys, chord, mac)) {
      event.preventDefault();
      if (input.isAutoRepeat) return;
      held = true;
      host.send("dictation:key", { kind: "down" });
    } else if (input.type === "keyUp" && held && releasesChord(input, chord, mac)) {
      held = false;
      host.send("dictation:key", { kind: "up" });
    } else if (isEscapeDown(input) && isListening()) {
      event.preventDefault();
      logger.info("[Dictation] Esc in a browser page while recording");
      toMain({ kind: "escape" });
    } else if (input.type === "keyDown" && isPlainEnter(input) && isListening() && isMain(host)) {
      event.preventDefault();
      host.send("dictation:key", { kind: "enter" });
    }
  });
}

/** Settings and floating windows have no overlay and no dictation keys of their own: their Esc
 *  cancels the main window's dictation. The main window keeps its Esc (an open dialog there
 *  takes it first) and also gets it relayed: its renderer's own listener missed it live */
export function forwardDictationEscape(
  contents: WebContents,
  isMain: () => boolean = () => contents === getMainWindow()?.webContents,
  toMain = sendToMain,
): void {
  contents.on("before-input-event", (event, input) => {
    if (!isEscapeDown(input) || !isListening()) return;
    if (isMain()) {
      logger.info("[Dictation] Esc in the main window while recording");
      toMain({ kind: "escape" });
      return;
    }
    event.preventDefault();
    toMain({ kind: "escape" });
  });
}
