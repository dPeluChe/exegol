// A window that went away mid-reading never says it stopped
const STALE_MS = 10 * 60_000;
const reading = new Map<number, number>();

/** A window reports that it plays a reply, or has one waiting to play */
export function noteReading(windowId: number, on: boolean, now = Date.now()): void {
  if (on) reading.set(windowId, now);
  else reading.delete(windowId);
}

/** The person is listening: what would make the Commander speak again waits */
export function isReadingAloud(now = Date.now()): boolean {
  for (const [id, since] of reading) {
    if (now - since < STALE_MS) return true;
    reading.delete(id);
  }
  return false;
}
