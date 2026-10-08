import type { DictationPhase } from "../../stores/dictation";

export type OverlayKeyAction = "insert" | "cancel" | "swallow" | null;

interface KeyInput {
  key: string;
  isComposing?: boolean;
  keyCode?: number;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}

interface KeyContext {
  /** The start target still has the focus: Enter is the dictation's */
  onTarget?: boolean;
  /** Another dialog is open: its Esc closes it first */
  dialogOpen?: boolean;
}

/** What a key does while the overlay is open; null leaves it to the focused pane or control.
 *  Esc cancels wherever the focus is. Enter inserts while recording, so it never reaches the
 *  target below; with another pane focused (the user moved on) Enter is that pane's */
export function overlayKeyAction(
  e: KeyInput,
  phase: DictationPhase,
  { onTarget = true, dialogOpen = false }: KeyContext = {},
): OverlayKeyAction {
  if (phase === "idle") return null;
  // 229: an IME is composing; its Enter or Esc ends the composition, not the dictation
  if (e.isComposing || e.keyCode === 229) return null;
  if (e.key === "Escape") return dialogOpen ? null : "cancel";
  if (e.key !== "Enter" || e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return null;
  if (!onTarget) return null;
  if (phase === "starting" || phase === "listening") return "insert";
  return phase === "transcribing" ? "swallow" : null;
}

/** The overlay's root carries this, so it never counts as another dialog */
export const OVERLAY_ATTR = "data-dictation-overlay";

/** A dialog on screen other than the overlay (a confirm, a popover): Esc is its first */
export function otherDialogOpen(root: ParentNode = document): boolean {
  for (const el of root.querySelectorAll('[role="dialog"], [role="alertdialog"]')) {
    if (!el.closest(`[${OVERLAY_ATTR}]`) && el.getClientRects().length > 0) return true;
  }
  return false;
}
