import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const IDE_COMMANDS: Record<string, string[]> = {
  vscode: ["code"],
  cursor: ["cursor"],
  zed: ["zed"],
  intellij: ["idea"],
  webstorm: ["webstorm"],
};

function shellEscape(s: string): string {
  return `'${s.replace(/'/g, "'\\''")}'`;
}

export async function openInIde(path: string, ide: string, customPath?: string): Promise<void> {
  if (ide === "custom" && customPath) {
    await execFileAsync(customPath, [path]);
    return;
  }
  const commands = IDE_COMMANDS[ide];
  if (!commands) throw new Error(`Unknown IDE: ${ide}`);
  // Spawn through shell for PATH resolution, with proper escaping
  const shell = process.env.SHELL || "/bin/zsh";
  await execFileAsync(shell, ["-ilc", `${commands[0]} ${shellEscape(path)}`], {
    timeout: 10_000,
  });
}
