import type { GpuRepaintReport } from "@exegol/shared";

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

const isCount = (n: unknown) => typeof n === "number" && Number.isInteger(n) && n >= 0 && n < 1e4;

export function parseGpuStats(input: unknown): TerminalGpuStats | null {
  if (!input || typeof input !== "object") return null;
  const { views, webgl, capped } = input as Record<string, unknown>;
  if (!isCount(views) || !isCount(webgl) || typeof capped !== "boolean") return null;
  return { views: views as number, webgl: webgl as number, capped };
}

export function parseGpuRepaint(input: unknown): GpuRepaintReport | null {
  if (!input || typeof input !== "object") return null;
  const { views, before, afterDrop, rebuilt } = input as Record<string, unknown>;
  const counts = [views, before, afterDrop, rebuilt];
  if (!counts.every(isCount) || (views as number) < 1) return null;
  return {
    views: views as number,
    before: before as number,
    afterDrop: afterDrop as number,
    rebuilt: rebuilt as number,
  };
}

/** The repaint line; an addon still held after the drop (WARN) is the blank-terminals case */
export function describeGpuRepaint(r: GpuRepaintReport): string {
  const line = `GPU process restarted: repainting ${r.views} terminal view(s), WebGL addons ${r.before} before, ${r.afterDrop} after the drop, ${r.rebuilt} rebuilt`;
  return r.afterDrop > 0 ? `${line}: one still held keeps the blank glyph atlas` : line;
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

const GPU_VENDORS: Record<number, string> = {
  4203: "Apple",
  4098: "AMD",
  4318: "NVIDIA",
  32902: "Intel",
  20803: "Qualcomm",
};

/** Always named: the rest of the feature table only when it is not plainly enabled */
const KEY_FEATURES = ["gpu_compositing", "webgl", "webgl2"];

/**
 * The GPU line for logs and the public bug report: the active device's vendor and driver plus the
 * feature status. Device ids, machine model and every other field are left out on purpose
 */
export function describeGpu(info: unknown, features: Record<string, string> | null): string {
  const devices = (info as { gpuDevice?: unknown } | null)?.gpuDevice;
  const list = Array.isArray(devices) ? (devices as Array<Record<string, unknown>>) : [];
  const device = list.find((d) => d.active === true) ?? list[0];
  const parts: string[] = [];
  if (device) {
    const id = typeof device.vendorId === "number" ? device.vendorId : null;
    const vendor = id === null ? "unknown" : (GPU_VENDORS[id] ?? `0x${id.toString(16)}`);
    const driver = [device.driverVendor, device.driverVersion]
      .filter((v): v is string => typeof v === "string" && v.length > 0 && v.length < 64)
      .join(" ");
    parts.push(`GPU ${vendor}${driver ? `, driver ${driver}` : ""}`);
  } else {
    parts.push("GPU unknown");
  }
  if (features) {
    const shown = Object.entries(features)
      .filter(([k, v]) => KEY_FEATURES.includes(k) || !v.startsWith("enabled"))
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}=${v}`);
    if (shown.length) parts.push(shown.join(" "));
  }
  return parts.join("; ");
}
