import type { RefObject } from "react";
import { claimPaneFocus } from "../lib/pane-focus";
import { useMountEffect } from "./use-mount-effect";

/** `ref` takes the keyboard when the pane opens for the user or keyboard navigation lands on it */
export function usePaneFocusTarget(paneId: string, ref: RefObject<HTMLElement | null>): void {
  useMountEffect(() => {
    const onFocusPane = (e: Event) => {
      if ((e as CustomEvent<{ paneId?: string }>).detail?.paneId === paneId) ref.current?.focus();
    };
    window.addEventListener("exegol:focus-pane", onFocusPane);
    if (claimPaneFocus(paneId)) ref.current?.focus();
    return () => window.removeEventListener("exegol:focus-pane", onFocusPane);
  });
}
