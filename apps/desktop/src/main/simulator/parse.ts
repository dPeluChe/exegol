import type { SimDevice, SimScreenSize } from "@exegol/shared";

export const UDID_PATTERN =
  /^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}$/;

/** "com.apple.CoreSimulator.SimRuntime.iOS-26-3" → "iOS 26.3" */
export function runtimeLabel(id: string): string {
  const tail = id.slice(id.lastIndexOf(".") + 1);
  const match = /^([A-Za-z]+)-(\d+(?:-\d+)*)$/.exec(tail);
  if (!match) return tail;
  return `${match[1]} ${(match[2] ?? "").replaceAll("-", ".")}`;
}

interface SimctlDevice {
  udid?: unknown;
  name?: unknown;
  state?: unknown;
  isAvailable?: unknown;
}

/** `simctl list devices available -j`: iOS first, then by runtime (newest first) and name */
export function parseSimctlDevices(json: string): SimDevice[] {
  let parsed: { devices?: Record<string, SimctlDevice[]> };
  try {
    parsed = JSON.parse(json);
  } catch {
    return [];
  }
  const devices: SimDevice[] = [];
  for (const [runtimeId, list] of Object.entries(parsed.devices ?? {})) {
    if (!Array.isArray(list)) continue;
    for (const d of list) {
      if (d.isAvailable === false) continue;
      if (typeof d.udid !== "string" || !UDID_PATTERN.test(d.udid)) continue;
      if (typeof d.name !== "string") continue;
      devices.push({
        udid: d.udid,
        name: d.name,
        runtime: runtimeLabel(runtimeId),
        state: typeof d.state === "string" ? d.state : "Unknown",
      });
    }
  }
  const platformRank = (runtime: string) => (runtime.startsWith("iOS") ? 0 : 1);
  return devices.sort(
    (a, b) =>
      platformRank(a.runtime) - platformRank(b.runtime) ||
      b.runtime.localeCompare(a.runtime, undefined, { numeric: true }) ||
      a.name.localeCompare(b.name, undefined, { numeric: true }),
  );
}

/** `axe describe-ui`: the root element's frame is the screen in points */
export function parseScreenSize(json: string): SimScreenSize | null {
  try {
    const tree = JSON.parse(json) as { frame?: { width?: unknown; height?: unknown } }[];
    const frame = Array.isArray(tree) ? tree[0]?.frame : undefined;
    const width = Number(frame?.width);
    const height = Number(frame?.height);
    return width > 0 && height > 0 ? { width, height } : null;
  } catch {
    return null;
  }
}

/** Where AXe can be: the login PATH's hit first, then Homebrew's two prefixes */
export function axeCandidates(onPath: string | null): string[] {
  return [...(onPath ? [onPath] : []), "/opt/homebrew/bin/axe", "/usr/local/bin/axe"].filter(
    (p, i, all) => all.indexOf(p) === i,
  );
}

/** Another tool ships an `axe` binary (Deque's axe-core CLI): AXe's help names the simulator */
export function looksLikeAxe(helpOutput: string): boolean {
  return /simulator/i.test(helpOutput) && /stream-video/.test(helpOutput);
}
