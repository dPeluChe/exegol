import { useEffect } from "react";
import { appChord, chordKey, IS_MAC } from "../lib/keymap";
import { useLatest } from "./use-latest";

/** An Esc that belongs to something else: a field, a recorder or menu that handled it, an open
 *  popover or dialog (Radix closes those first) */
function escTaken(e: KeyboardEvent): boolean {
  if (e.defaultPrevented) return true;
  const el = e.target as HTMLElement | null;
  if (el?.closest("input, textarea, select, [contenteditable='true']")) return true;
  return !!document.querySelector("[data-radix-popper-content-wrapper], [role='dialog']");
}

/** Settings and floating windows: Esc closes them, and Ctrl+Shift+W off macOS (on macOS the app
 *  menu routes Cmd+W). A focused terminal keeps its Esc: xterm sends it and stops the event */
export function useWindowCloseKeys(close: () => void): void {
  const closeRef = useLatest(close);
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const closeChord = !IS_MAC && appChord(e) && chordKey(e) === "w";
      if (!closeChord && (e.key !== "Escape" || escTaken(e))) return;
      e.preventDefault();
      closeRef.current();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [closeRef]);
}
