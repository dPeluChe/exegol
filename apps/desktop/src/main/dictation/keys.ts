import { type KeyChord, matchesChord, releasesChord } from "@exegol/shared";
import type { WebContents } from "electron";
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

const hostIsMain = (host: WebContents) => host === getMainWindow()?.webContents;

/** A page in a browser pane keeps its keys: the dictation chord (down and up, for hold-to-talk)
 *  goes to the window hosting it; Esc and Enter while a dictation runs only from the main window,
 *  the one with the overlay */
export function forwardDictationKeys(contents: WebContents, isMain = hostIsMain): void {
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
    } else if (
      input.type === "keyDown" &&
      input.key === "Escape" &&
      isListening() &&
      isMain(host)
    ) {
      event.preventDefault();
      host.send("dictation:key", { kind: "escape" });
    } else if (input.type === "keyDown" && isPlainEnter(input) && isListening() && isMain(host)) {
      event.preventDefault();
      host.send("dictation:key", { kind: "enter" });
    }
  });
}
