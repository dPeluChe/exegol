import { app, BrowserWindow, ipcMain, powerMonitor, screen } from "electron";
import { broadcast } from "../lib/event-bus";
import { logger } from "../lib/logger";
import { withTimeout } from "../lib/timeout";
import {
  createGpuCrashTracker,
  describeGpu,
  describeGpuCrash,
  describeGpuRepaint,
  parseGpuRepaint,
  parseGpuStats,
  type SystemEvent,
  type TerminalGpuStats,
} from "./gpu-crash";

/** Last terminal counts each window reported (`terminal:gpu-stats`), by webContents id */
const statsByWindow = new Map<number, TerminalGpuStats>();
const tracker = createGpuCrashTracker();
let lastEvent: SystemEvent | null = null;
/** Read once at start: asking the GPU process right after it died could hang or fail */
let gpuInfo: unknown = null;

/** Vendor, driver and feature status (no device or machine identifiers): logs and bug reports */
export async function gpuSummary(): Promise<string> {
  // A hung GPU process must never hold up the bug report
  gpuInfo ??= await withTimeout(app.getGPUInfo("basic"), 1_000, "getGPUInfo").catch(() => null);
  return describeGpu(gpuInfo, gpuFeatures());
}

function gpuFeatures(): Record<string, string> | null {
  try {
    return { ...app.getGPUFeatureStatus() } as Record<string, string>;
  } catch {
    return null;
  }
}

function note(name: string): void {
  // Linux (logind) delivers suspend and resume twice within milliseconds: one line each
  if (lastEvent?.name === name && Date.now() - lastEvent.at < 2000) return;
  lastEvent = { name, at: Date.now() };
  logger.info(`[System] ${name}`);
}

const onSuspend = () => note("suspend");
const onResume = () => note("resume");
const onDisplayAdded = () => note("display added");
const onDisplayRemoved = () => note("display removed");
const onDisplayMetrics = (_e: unknown, _display: unknown, changed: string[]) => {
  // workArea alone moves with the Dock and the menu bar: no GPU surface changes
  const real = changed.filter((c) => c !== "workArea");
  if (real.length > 0) note(`display ${real.join(",")} changed`);
};

export function startGpuWatch(): void {
  // Feature status reads all "disabled" until the GPU process reports (Electron docs)
  app.once("gpu-info-update", () => {
    app
      .getGPUInfo("basic")
      .then((info) => {
        gpuInfo = info;
        logger.info(`[GPU] ${describeGpu(info, gpuFeatures())}`);
      })
      .catch(() => {});
  });
  ipcMain.on("terminal:gpu-stats", (event, input: unknown) => {
    const stats = parseGpuStats(input);
    if (!stats) return;
    const id = event.sender.id;
    const prev = statsByWindow.get(id);
    if (!prev) event.sender.once("destroyed", () => statsByWindow.delete(id));
    if (stats.capped && !prev?.capped) {
      logger.warn(
        `[Terminal] WebGL context cap reached in w${id}: more terminals use the DOM renderer`,
      );
    }
    statsByWindow.set(id, stats);
  });
  ipcMain.on("terminal:gpu-repainted", (_event, input: unknown) => {
    const report = parseGpuRepaint(input);
    if (!report) return;
    const log = report.afterDrop > 0 ? logger.warn : logger.info;
    log(`[Terminal] ${describeGpuRepaint(report)}`);
  });
  ipcMain.handle("gpu:dom-only", () => tracker.isDomOnly());
  powerMonitor.on("suspend", onSuspend);
  powerMonitor.on("resume", onResume);
  screen.on("display-added", onDisplayAdded);
  screen.on("display-removed", onDisplayRemoved);
  screen.on("display-metrics-changed", onDisplayMetrics);
}

export function stopGpuWatch(): void {
  powerMonitor.off("suspend", onSuspend);
  powerMonitor.off("resume", onResume);
  screen.off("display-added", onDisplayAdded);
  screen.off("display-removed", onDisplayRemoved);
  screen.off("display-metrics-changed", onDisplayMetrics);
}

/** Logs what was on screen, applies the 3-crash rule and tells every window to repaint */
export function handleGpuProcessGone(details: { reason: string; exitCode: number }): void {
  const now = Date.now();
  const context = describeGpuCrash(
    BrowserWindow.getAllWindows().length,
    statsByWindow.values(),
    lastEvent,
    now,
  );
  logger.warn(
    `[GPU] process gone (${details.reason}, exit ${details.exitCode}): ${context}; ${describeGpu(gpuInfo, gpuFeatures())}`,
  );
  const verdict = tracker.record(now);
  if (verdict.switched) {
    logger.warn(
      `[GPU] ${verdict.recent} crashes in 10 min: terminals use the DOM renderer for the rest of this session`,
    );
  }
  broadcast("gpu:process-gone", { domOnly: tracker.isDomOnly() });
}
