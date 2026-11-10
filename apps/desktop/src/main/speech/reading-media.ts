import { holdMedia, type MediaHold, mediaBackend } from "../dictation/media-pause";
import { isReadingAloud } from "./reading";

// A reading has no fixed end; each one that starts renews this
const HOLD_MS = 10 * 60_000;

let hold: MediaHold | null = null;

/** What plays on the machine pauses while a reply is heard, and resumes when no window reads */
export function syncReadingMedia(
  settings: () => { pauseMedia: boolean; pauseMediaDirect: boolean },
  start: typeof holdMedia = holdMedia,
): void {
  if (!isReadingAloud()) {
    releaseReadingMedia();
    return;
  }
  if (hold?.extend(HOLD_MS)) return;
  const { pauseMedia, pauseMediaDirect } = settings();
  hold = pauseMedia ? start(HOLD_MS, mediaBackend({ direct: pauseMediaDirect })) : null;
}

/** Also before a dictation takes the pause over: released first, it resumes nothing in between */
export function releaseReadingMedia(): void {
  hold?.release();
  hold = null;
}
