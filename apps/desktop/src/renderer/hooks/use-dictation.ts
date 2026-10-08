import {
  type DictationCancelSource,
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
  dictationLimitReached,
  dismissDictation,
  focusOnTarget,
  stopDictation,
} from "../lib/dictation/controller";
import { otherDialogOpen, overlayKeyAction } from "../lib/dictation/overlay-keys";
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

/** A key main forwarded (a page's or another window's): plain, no IME */
const forwardedKey = (key: "Enter" | "Escape") => ({
  key,
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
});

/** One decision for keys typed here and keys main forwarded; true when the key was taken */
function runKey(e: Parameters<typeof overlayKeyAction>[0], escSource: DictationCancelSource) {
  const phase = useDictationStore.getState().phase;
  const action = overlayKeyAction(e, phase, {
    onTarget: e.key !== "Enter" || focusOnTarget(),
    dialogOpen: e.key === "Escape" && phase !== "idle" && otherDialogOpen(),
  });
  if (action === "cancel") dismissDictation(escSource);
  else if (action === "insert") void stopDictation("enter");
  return action !== null;
}

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
      if (!runKey(e, "esc")) return;
      e.preventDefault();
      e.stopPropagation();
    };
    const onKeyUp = (e: KeyboardEvent) => {
      const chord = dictationChord();
      if (chord && releasesChord(e, chord, IS_MAC)) chordUp();
    };
    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("keyup", onKeyUp, true);
    // App-level focus (main's relay), not the DOM blur: a browser pane's webview blurs the page
    const offFocus = window.api.onWindowFocus(appFocusChanged);
    const offKey = window.api.dictation.onKey((event) => {
      const { kind } = event;
      if (kind === "limit") dictationLimitReached(event.sessionId, event.maxSeconds);
      else if (kind === "down") chordDown();
      else if (kind === "up") chordUp();
      else runKey(forwardedKey(kind === "enter" ? "Enter" : "Escape"), "esc-forwarded");
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
