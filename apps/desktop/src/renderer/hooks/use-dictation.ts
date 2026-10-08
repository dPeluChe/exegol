import {
  type DictationStatus,
  dictationSettingsOf,
  type KeyChord,
  parseChord,
  releasesChord,
  type Settings,
} from "@exegol/shared";
import { useQueryClient } from "@tanstack/react-query";
import {
  appFocusChanged,
  bindDictationQueries,
  chordDown,
  chordUp,
  dismissDictation,
  stopDictation,
} from "../lib/dictation/controller";
import { overlayKeyAction } from "../lib/dictation/overlay-keys";
import {
  dictationChord,
  isDictationChord,
  setDictationChordSource,
} from "../lib/dictation/shortcut";
import { IS_MAC } from "../lib/keymap";
import { useDictationStore } from "../stores/dictation";
import { useMountEffect } from "./use-mount-effect";
import { useSettings } from "./use-trpc";
import { DICTATION_STATUS_KEY, useDictationStatus } from "./use-trpc-dictation";

/** The dictation shortcut (toggle, or hold to talk) and its events. Capture phase: Monaco and
 *  xterm would otherwise take the chord first (Cmd+Shift+Space is Monaco's parameter hints) */
export function useDictation() {
  const queryClient = useQueryClient();
  useSettings();
  useDictationStatus();

  useMountEffect(() => {
    bindDictationQueries(queryClient);
    let cached: { key: string; chord: KeyChord | null } = { key: "", chord: null };
    setDictationChordSource(() => {
      const saved = queryClient.getQueryData<Settings>(["settings"])?.dictation;
      const d = dictationSettingsOf(saved);
      // No speech engine on this system: the chord stays the app's (or the terminal's)
      const engine = queryClient.getQueryData<DictationStatus>(DICTATION_STATUS_KEY);
      const key = d.enabled && engine?.engineAvailable ? d.shortcut : "";
      if (key !== cached.key) cached = { key, chord: key ? parseChord(key) : null };
      return cached.chord;
    });

    const onKeyDown = (e: KeyboardEvent) => {
      if (isDictationChord(e)) {
        e.preventDefault();
        e.stopPropagation();
        if (!e.repeat) chordDown();
        return;
      }
      const action = overlayKeyAction(e, useDictationStore.getState().phase);
      if (!action) return;
      e.preventDefault();
      e.stopPropagation();
      if (action === "cancel") dismissDictation();
      else if (action === "insert") void stopDictation();
    };
    const onKeyUp = (e: KeyboardEvent) => {
      const chord = dictationChord();
      if (chord && releasesChord(e, chord, IS_MAC)) chordUp();
    };
    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("keyup", onKeyUp, true);
    // App-level focus (main's relay), not the DOM blur: a browser pane's webview blurs the page
    const offFocus = window.api.onWindowFocus(appFocusChanged);
    const offKey = window.api.dictation.onKey(({ kind }) => {
      if (kind === "down") chordDown();
      else if (kind === "up") chordUp();
      else if (kind === "enter") void stopDictation();
      else dismissDictation();
    });
    const offPartial = window.api.dictation.onPartial(({ sessionId, text }) => {
      const store = useDictationStore.getState();
      if (store.sessionId === sessionId) store.set({ partial: text });
    });
    const offEngine = window.api.dictation.onEngine(({ state }) =>
      useDictationStore.getState().set({ modelLoading: state === "loading" }),
    );
    return () => {
      setDictationChordSource(() => null);
      bindDictationQueries(null);
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("keyup", onKeyUp, true);
      offFocus();
      offKey();
      offPartial();
      offEngine();
    };
  });
}
