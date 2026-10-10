import type { SimDevice } from "@exegol/shared";
import { execFileAsync } from "../lib/exec-file";
import { parseSimctlDevices } from "./parse";

const LIST_TTL_MS = 2_000;
let listCache: { at: number; devices: Promise<SimDevice[]> } | null = null;
let simctlFound: boolean | null = null;

/** macOS with Xcode selected (`xcrun` alone is a stub that asks to install the tools) */
export async function simctlAvailable(): Promise<boolean> {
  if (process.platform !== "darwin") return false;
  if (simctlFound) return true;
  simctlFound = await execFileAsync("xcrun", ["--find", "simctl"], { timeout: 5_000 })
    .then(() => true)
    .catch(() => false);
  return simctlFound;
}

/** Available devices, cached briefly: every simulator pane polls the list */
export function listDevices(force = false): Promise<SimDevice[]> {
  if (!force && listCache && Date.now() - listCache.at < LIST_TTL_MS) return listCache.devices;
  const devices = execFileAsync("xcrun", ["simctl", "list", "devices", "available", "-j"], {
    timeout: 15_000,
    maxBuffer: 16 * 1024 * 1024,
  }).then(({ stdout }) => parseSimctlDevices(stdout));
  listCache = { at: Date.now(), devices };
  devices.catch(() => {
    if (listCache?.devices === devices) listCache = null;
  });
  return devices;
}

export async function findDevice(udid: string): Promise<SimDevice | undefined> {
  return (await listDevices()).find((d) => d.udid === udid);
}

/** Boots and waits until the device is usable; already booted is fine */
export async function bootDevice(udid: string): Promise<void> {
  await execFileAsync("xcrun", ["simctl", "boot", udid], { timeout: 60_000 }).catch((err) => {
    if (!/current state: Booted/i.test(String(err?.stderr ?? err))) throw err;
  });
  listCache = null;
  await execFileAsync("xcrun", ["simctl", "bootstatus", udid, "-b"], { timeout: 180_000 });
  listCache = null;
}

export async function shutdownDevice(udid: string): Promise<void> {
  await execFileAsync("xcrun", ["simctl", "shutdown", udid], { timeout: 60_000 }).catch((err) => {
    if (!/current state: Shutdown/i.test(String(err?.stderr ?? err))) throw err;
  });
  listCache = null;
}

export async function saveScreenshot(udid: string, path: string): Promise<void> {
  await execFileAsync("xcrun", ["simctl", "io", udid, "screenshot", "--type=png", path], {
    timeout: 20_000,
  });
}

/** Simulator.app on this device (it boots it if needed) */
export async function openSimulatorApp(udid: string): Promise<void> {
  await execFileAsync("open", ["-a", "Simulator", "--args", "-CurrentDeviceUDID", udid], {
    timeout: 15_000,
  });
}
