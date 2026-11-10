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

export function releaseReadingMedia(): void {
  hold?.release();
  hold = null;
}

/** A dictation keeps the pause as its own: released and held again, the music plays in between */
export function takeReadingMedia(): MediaHold | null {
  const taken = hold;
  hold = null;
  return taken;
}
