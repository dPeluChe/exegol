import type { ScreenDialog } from "@exegol/shared";

export interface Watched {
  /** Output stamp of the last read: nothing new on screen, nothing to read */
  readAt?: number;
  /** Seen once, not alerted: a dialog counts when it holds still for two reads */
  seen?: string;
  /** The dialog already alerted, and whether this watch moved the status for it */
  alerted?: string;
  movedStatus?: boolean;
}

export type QuestionStep = "none" | "alert" | "resolved";

/** One read of a session's screen; pure so the two-read rule and the release stay testable */
export function questionStep(state: Watched, dialog: ScreenDialog | null): QuestionStep {
  if (!dialog?.picked) {
    state.seen = undefined;
    if (!state.alerted) return "none";
    state.alerted = undefined;
    return "resolved";
  }
  if (dialog.fingerprint === state.alerted) return "none";
  if (dialog.fingerprint !== state.seen) {
    state.seen = dialog.fingerprint;
    return "none";
  }
  state.seen = undefined;
  state.alerted = dialog.fingerprint;
  return "alert";
}
