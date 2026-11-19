import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { logger } from "../lib/logger";
import { nodeLaunch, nodeShellCommand } from "../system/node-launch";
import { AGENT_CLI } from "./agent-cli";
import { resolveBundledBin } from "./exegol-mcp-config";
import { EXEGOL_DIR } from "./exegol-protocol";

/** On every session's PATH (`agent-spawn-flow.ts`): holds the launcher of `exegol-agent` */
export const AGENT_BIN_DIR = join(EXEGOL_DIR, "bin");
const AGENT_BIN = "exegol-agent-bin.js";

export function launcherText(script: string, platform = process.platform): string {
  const launch = nodeLaunch(script);
  if (platform === "win32") {
    const line = [launch.command, ...launch.args].map((a) => `"${a}"`).join(" ");
    return `@echo off\r\nset ELECTRON_RUN_AS_NODE=1\r\n${line} %*\r\n`;
  }
  return `#!/bin/sh\n${nodeShellCommand(launch)} "$@"\n`;
}

/** Written at each start, so it follows the app when it moves or updates */
export function installAgentCli(): void {
  const script = resolveBundledBin(AGENT_BIN);
  if (!script) return;
  const file = join(AGENT_BIN_DIR, process.platform === "win32" ? `${AGENT_CLI}.cmd` : AGENT_CLI);
  const text = launcherText(script);
  try {
    if (existsSync(file) && readFileSync(file, "utf-8") === text) return;
    mkdirSync(AGENT_BIN_DIR, { recursive: true, mode: 0o700 });
    writeFileSync(file, text, { mode: 0o755 });
    chmodSync(file, 0o755);
  } catch (err) {
    logger.warn("[ExegolMcp] could not write the exegol-agent launcher:", err);
  }
}
