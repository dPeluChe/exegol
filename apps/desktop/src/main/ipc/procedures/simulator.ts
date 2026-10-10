import { rm } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import {
  SIM_BUTTONS,
  SIM_KEYCODES,
  SIM_TYPE_TEXT,
  type SimKey,
  type SimulatorSupport,
} from "@exegol/shared";
import { BrowserWindow, clipboard, dialog, ipcMain, nativeImage } from "electron";
import { z } from "zod";
import {
  detectAxe,
  pressButton,
  pressKey,
  screenSize,
  swipe,
  tap,
  typeText,
} from "../../simulator/axe";
import { UDID_PATTERN } from "../../simulator/parse";
import {
  bootDevice,
  findDevice,
  listDevices,
  openSimulatorApp,
  saveScreenshot,
  shutdownDevice,
  simctlAvailable,
} from "../../simulator/simctl";
import { setStreamVisible, startStream, stopStream } from "../../simulator/stream";
import { publicProcedure, router } from "../trpc";

const udid = z.string().regex(UDID_PATTERN);
const device = z.object({ udid });
const coord = z.number().finite().min(0).max(10_000);
const point = z.object({ x: coord, y: coord });
const simKeys = Object.keys(SIM_KEYCODES) as [SimKey, ...SimKey[]];
const PANE_ID = /^[\w-]{1,64}$/;

const stamp = () => new Date().toISOString().slice(0, 19).replaceAll(":", ".").replace("T", " at ");

/** T203: the Simulator pane. Main-side calls live in `main/simulator/` so agent tools reuse them */
export const simulatorRouter = router({
  support: publicProcedure.query(
    async (): Promise<SimulatorSupport> => ({
      simctl: await simctlAvailable(),
      axe: await detectAxe(),
    }),
  ),

  devices: publicProcedure.query(async () => ((await simctlAvailable()) ? listDevices() : [])),

  boot: publicProcedure.input(device).mutation(async ({ input }) => {
    await bootDevice(input.udid);
    return { ok: true };
  }),

  shutdown: publicProcedure.input(device).mutation(async ({ input }) => {
    await shutdownDevice(input.udid);
    return { ok: true };
  }),

  /** Points (AXe's coordinates); null until the device answers */
  screenSize: publicProcedure.input(device).query(({ input }) => screenSize(input.udid)),

  tap: publicProcedure.input(device.extend({ x: coord, y: coord })).mutation(async ({ input }) => {
    await tap(input.udid, input.x, input.y);
    return { ok: true };
  }),

  swipe: publicProcedure
    .input(device.extend({ from: point, to: point, durationS: z.number().min(0.05).max(5) }))
    .mutation(async ({ input }) => {
      await swipe(input.udid, input.from, input.to, input.durationS);
      return { ok: true };
    }),

  type: publicProcedure
    .input(device.extend({ text: z.string().regex(SIM_TYPE_TEXT) }))
    .mutation(async ({ input }) => {
      await typeText(input.udid, input.text);
      return { ok: true };
    }),

  key: publicProcedure
    .input(device.extend({ key: z.enum(simKeys) }))
    .mutation(async ({ input }) => {
      await pressKey(input.udid, input.key);
      return { ok: true };
    }),

  button: publicProcedure
    .input(device.extend({ button: z.enum(SIM_BUTTONS) }))
    .mutation(async ({ input }) => {
      await pressButton(input.udid, input.button);
      return { ok: true };
    }),

  /** Full-resolution PNG from simctl: to the clipboard, or a file the user picks */
  screenshot: publicProcedure
    .input(device.extend({ to: z.enum(["clipboard", "file"]) }))
    .mutation(async ({ input }) => {
      const name = ((await findDevice(input.udid))?.name ?? "Simulator").replace(/[/:]/g, "-");
      if (input.to === "file") {
        const win = BrowserWindow.getFocusedWindow();
        const options = {
          defaultPath: join(homedir(), "Desktop", `${name} ${stamp()}.png`),
          filters: [{ name: "PNG", extensions: ["png"] }],
        };
        const picked = await (win
          ? dialog.showSaveDialog(win, options)
          : dialog.showSaveDialog(options));
        if (picked.canceled || !picked.filePath) return { ok: false };
        await saveScreenshot(input.udid, picked.filePath);
        return { ok: true };
      }
      const tmp = join(tmpdir(), `exegol-sim-${process.pid}-${Date.now()}.png`);
      try {
        await saveScreenshot(input.udid, tmp);
        clipboard.writeImage(nativeImage.createFromPath(tmp));
      } finally {
        await rm(tmp, { force: true });
      }
      return { ok: true };
    }),

  openApp: publicProcedure.input(device).mutation(async ({ input }) => {
    await openSimulatorApp(input.udid);
    return { ok: true };
  }),
});

type StreamInput = { paneId?: unknown; udid?: unknown };
const validPane = (paneId: unknown): paneId is string =>
  typeof paneId === "string" && PANE_ID.test(paneId);

/** Live view: frames go back on `simulator:frame` to the window that asked, never a port */
export function registerSimulatorIpc(): void {
  ipcMain.handle("simulator:stream-start", (event, input: StreamInput) => {
    if (!validPane(input?.paneId) || !udid.safeParse(input?.udid).success) return false;
    startStream(event.sender, input.paneId, input.udid as string);
    return true;
  });
  ipcMain.on("simulator:stream-visible", (event, paneId: unknown, visible: unknown) => {
    if (validPane(paneId)) setStreamVisible(event.sender, paneId, visible === true);
  });
  ipcMain.on("simulator:stream-stop", (event, paneId: unknown) => {
    if (validPane(paneId)) stopStream(event.sender, paneId);
  });
}
