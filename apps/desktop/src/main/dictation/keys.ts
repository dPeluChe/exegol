import { type KeyChord, matchesChord, releasesChord } from "@exegol/shared";
import type { WebContents } from "electron";

let chord: KeyChord | null = null;
let isListening: () => boolean = () => false;

export function setDictationChord(next: KeyChord | null): void {
  chord = next;
}

export function setDictationListening(check: () => boolean): void {
  isListening = check;
}

const isPlainEnter = (input: Electron.Input) =>
  input.key === "Enter" && !input.meta && !input.control && !input.alt && !input.shift;

/** A page in a browser pane keeps its keys: the dictation chord (down and up, for hold-to-talk)
 *  and Esc while a dictation runs go to the window hosting it */
export function forwardDictationKeys(contents: WebContents): void {
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
    } else if (input.type === "keyDown" && input.key === "Escape" && isListening()) {
      event.preventDefault();
      host.send("dictation:key", { kind: "escape" });
    } else if (input.type === "keyDown" && isPlainEnter(input) && isListening()) {
      event.preventDefault();
      host.send("dictation:key", { kind: "enter" });
    }
  });
}
