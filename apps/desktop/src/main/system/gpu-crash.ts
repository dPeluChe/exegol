/** Crashes this close together mean WebGL itself is the trigger on this machine */
export const GPU_CRASH_LIMIT = 3;
export const GPU_CRASH_WINDOW_MS = 10 * 60_000;
/** A sleep or display change this recent is worth naming next to a crash */
const RECENT_EVENT_MS = 2 * 60_000;

export interface GpuCrashVerdict {
  /** Crashes inside the window, this one included */
  recent: number;
  /** This crash is the one that switched terminals to the DOM renderer */
  switched: boolean;
}

export function createGpuCrashTracker(limit = GPU_CRASH_LIMIT, windowMs = GPU_CRASH_WINDOW_MS) {
  let crashes: number[] = [];
  let domOnly = false;
  return {
    record(now: number): GpuCrashVerdict {
      crashes = [...crashes.filter((at) => now - at < windowMs), now];
      const switched = !domOnly && crashes.length >= limit;
      if (switched) domOnly = true;
      return { recent: crashes.length, switched };
    },
    isDomOnly: () => domOnly,
  };
}

export interface TerminalGpuStats {
  views: number;
  webgl: number;
  capped: boolean;
}

export function parseGpuStats(input: unknown): TerminalGpuStats | null {
  if (!input || typeof input !== "object") return null;
  const { views, webgl, capped } = input as Record<string, unknown>;
  const count = (n: unknown) => typeof n === "number" && Number.isInteger(n) && n >= 0 && n < 1e4;
  if (!count(views) || !count(webgl) || typeof capped !== "boolean") return null;
  return { views: views as number, webgl: webgl as number, capped };
}

export interface SystemEvent {
  name: string;
  at: number;
}

/** The context line logged with a GPU crash: counts and the last sleep or display change */
export function describeGpuCrash(
  windows: number,
  stats: Iterable<TerminalGpuStats>,
  lastEvent: SystemEvent | null,
  now: number,
): string {
  let views = 0;
  let webgl = 0;
  for (const s of stats) {
    views += s.views;
    webgl += s.webgl;
  }
  const ago = lastEvent ? Math.round((now - lastEvent.at) / 1000) : null;
  const event =
    lastEvent && ago !== null && now - lastEvent.at <= RECENT_EVENT_MS
      ? `${lastEvent.name} ${ago}s before`
      : "no sleep or display change in the last 2 min";
  return `${windows} window(s), ${views} terminal view(s), ${webgl} WebGL context(s), ${event}`;
}
