import { existsSync } from "node:fs";
import type { SimButton, SimKey, SimScreenSize } from "@exegol/shared";
import { SIM_KEYCODES } from "@exegol/shared";
import { findOnPath } from "../agents/spawn-env";
import { execFileAsync } from "../lib/exec-file";
import { axeCandidates, looksLikeAxe, parseScreenSize } from "./parse";

let found: string | null = null;

/** AXe's path or null. A miss is not cached: the user installs it and clicks Check again */
export async function detectAxe(): Promise<string | null> {
  if (process.platform !== "darwin") return null;
  if (found && existsSync(found)) return found;
  found = null;
  for (const path of axeCandidates(findOnPath("axe"))) {
    if (!existsSync(path)) continue;
    const help = await execFileAsync(path, ["--help"], { timeout: 5_000 })
      .then(({ stdout }) => stdout)
      .catch(() => "");
    if (looksLikeAxe(help)) {
      found = path;
      return path;
    }
  }
  return null;
}

async function axePath(): Promise<string> {
  const path = await detectAxe();
  if (!path) throw new Error("AXe is not installed");
  return path;
}

/** One AXe call; `input` goes on stdin so typed text never shows in a process list */
export async function runAxe(
  args: string[],
  opts: { input?: string; timeoutMs?: number } = {},
): Promise<string> {
  const path = await axePath();
  const call = execFileAsync(path, args, {
    timeout: opts.timeoutMs ?? 15_000,
    killSignal: "SIGKILL",
    maxBuffer: 16 * 1024 * 1024,
  });
  call.child.stdin?.end(opts.input ?? "");
  try {
    return (await call).stdout;
  } catch (err) {
    const { code, signal, stderr } = err as { code?: unknown; signal?: unknown; stderr?: unknown };
    const detail = String(stderr ?? "")
      .trim()
      .slice(0, 2_000);
    throw new Error(`axe ${args[0]} failed (${code ?? signal ?? "error"}): ${detail}`);
  }
}

const num = (n: number) => String(Math.round(n * 10) / 10);

export function tap(udid: string, x: number, y: number) {
  return runAxe(["tap", "-x", num(x), "-y", num(y), "--udid", udid]);
}

export function swipe(
  udid: string,
  from: { x: number; y: number },
  to: { x: number; y: number },
  durationS: number,
) {
  return runAxe([
    "swipe",
    "--start-x",
    num(from.x),
    "--start-y",
    num(from.y),
    "--end-x",
    num(to.x),
    "--end-y",
    num(to.y),
    "--duration",
    num(durationS),
    "--udid",
    udid,
  ]);
}

export function typeText(udid: string, text: string) {
  return runAxe(["type", "--stdin", "--udid", udid], { input: text, timeoutMs: 60_000 });
}

export function pressKey(udid: string, key: SimKey) {
  return runAxe(["key", String(SIM_KEYCODES[key]), "--udid", udid]);
}

export function pressButton(udid: string, button: SimButton) {
  return runAxe(["button", button, "--udid", udid]);
}

function describeUi(udid: string) {
  return runAxe(["describe-ui", "--udid", udid], { timeoutMs: 20_000 });
}

/** The screen in points; null when the tree did not answer (the caller falls back) */
export async function screenSize(udid: string): Promise<SimScreenSize | null> {
  return parseScreenSize(await describeUi(udid).catch(() => ""));
}
