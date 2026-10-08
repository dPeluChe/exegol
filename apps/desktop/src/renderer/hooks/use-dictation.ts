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
  bindDictationQueries,
  chordDown,
  chordUp,
  dismissDictation,
  leaveWindow,
} from "../lib/dictation/controller";
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
      if (e.key === "Escape" && useDictationStore.getState().phase !== "idle") {
        e.preventDefault();
        e.stopPropagation();
        dismissDictation();
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      const chord = dictationChord();
      if (chord && releasesChord(e, chord, IS_MAC)) chordUp();
    };
    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("keyup", onKeyUp, true);
    // Focus moving into a browser pane's page blurs the window but keeps the document focused
    const onBlur = () =>
      setTimeout(() => {
        if (!document.hasFocus()) leaveWindow();
      }, 0);
    const onVisibility = () => {
      if (document.hidden) leaveWindow();
    };
    window.addEventListener("blur", onBlur);
    document.addEventListener("visibilitychange", onVisibility);
    const offKey = window.api.dictation.onKey(({ kind }) => {
      if (kind === "down") chordDown();
      else if (kind === "up") chordUp();
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
      window.removeEventListener("blur", onBlur);
      document.removeEventListener("visibilitychange", onVisibility);
      offKey();
      offPartial();
      offEngine();
    };
  });
}
