import { type KeyChord, matchesChord } from "@exegol/shared";
import { IS_MAC } from "../keymap";

let source: () => KeyChord | null = () => null;

/** Where the chord in effect is read from (the settings cache); null when dictation is off */
export function setDictationChordSource(read: () => KeyChord | null): void {
  source = read;
}

export const dictationChord = (): KeyChord | null => source();

/** For key handlers that would otherwise eat it (the terminal's) */
export function isDictationChord(e: KeyboardEvent): boolean {
  const chord = source();
  return !!chord && matchesChord(e, chord, IS_MAC);
}
