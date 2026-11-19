import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { logger } from "../lib/logger";
import { nodeLaunch, nodeShellCommand } from "../system/node-launch";
import { AGENT_BIN, AGENT_CLI } from "./agent-cli";
import { resolveBundledBin } from "./exegol-mcp-config";
import { EXEGOL_DIR } from "./exegol-protocol";

/** On every session's PATH (`agent-spawn-flow.ts`): holds the launcher of `exegol-agent` */
export const AGENT_BIN_DIR = join(EXEGOL_DIR, "bin");

export function launcherText(script: string, kind: "sh" | "cmd"): string {
  const launch = nodeLaunch(script);
  if (kind === "cmd") {
    const line = [launch.command, ...launch.args].map((a) => `"${a}"`).join(" ");
    // setlocal: the variable must not stay in the cmd.exe that called it
    return `@echo off\r\nsetlocal\r\nset ELECTRON_RUN_AS_NODE=1\r\n${line} %*\r\n`;
  }
  return `#!/bin/sh\nexec env ${nodeShellCommand(launch)} "$@"\n`;
}

function write(file: string, text: string): void {
  if (existsSync(file) && readFileSync(file, "utf-8") === text) return;
  writeFileSync(file, text, { mode: 0o755 });
  chmodSync(file, 0o755);
}

/** Written at each start, so it follows the app when it moves or updates. Windows gets both:
 *  cmd and PowerShell run the .cmd, Git Bash (Claude Code's shell there) the sh one */
export function installAgentCli(): void {
  const script = resolveBundledBin(AGENT_BIN);
  if (!script) return;
  try {
    mkdirSync(AGENT_BIN_DIR, { recursive: true, mode: 0o700 });
    write(join(AGENT_BIN_DIR, AGENT_CLI), launcherText(script, "sh"));
    if (process.platform === "win32") {
      write(join(AGENT_BIN_DIR, `${AGENT_CLI}.cmd`), launcherText(script, "cmd"));
    }
  } catch (err) {
    logger.warn("[ExegolMcp] could not write the exegol-agent launcher:", err);
  }
}
