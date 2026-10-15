import type { VadState } from "./vad";

/** The overlay counts down this last stretch of the silence before inserting */
export const AUTO_INSERT_COUNTDOWN_MS = 3_000;

export type AutoInsert =
  | { kind: "off" }
  | { kind: "waiting" }
  | { kind: "countdown"; remainingMs: number }
  | { kind: "fire" };

interface AutoInsertContext {
  enabled: boolean;
  delaySec: number;
  paused: boolean;
  /** A click on the countdown turned it off for this dictation */
  dismissed: boolean;
}

/** Where the silence after speech stands against the auto insert delay. The VAD's silence resets
 *  on any speech, so speech resets the countdown too */
export function autoInsertState(vad: VadState, ctx: AutoInsertContext): AutoInsert {
  if (!ctx.enabled || ctx.paused || ctx.dismissed || !vad.heard) return { kind: "off" };
  const remainingMs = ctx.delaySec * 1000 - vad.silenceMs;
  if (remainingMs <= 0) return { kind: "fire" };
  if (remainingMs <= AUTO_INSERT_COUNTDOWN_MS) return { kind: "countdown", remainingMs };
  return { kind: "waiting" };
}

/** The countdown the overlay shows, null outside it */
export const countdownMs = (state: AutoInsert): number | null =>
  state.kind === "countdown" ? state.remainingMs : null;

/** Silence before a pause does not count after the resume */
export const resumedVad = (vad: VadState): VadState => ({ ...vad, silenceMs: 0 });
