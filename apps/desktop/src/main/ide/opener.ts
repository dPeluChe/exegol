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

  const command = commands[0];
  const shell = process.env.SHELL || "/bin/zsh";

  // Validate the binary exists on PATH before launching
  try {
    await execFileAsync(shell, ["-ilc", `which ${command}`], { timeout: 5000 });
  } catch {
    throw new Error(
      `IDE '${ide}' (command: ${command}) not found on PATH. Install it or set a custom IDE path in Settings.`,
    );
  }

  // Spawn through shell for PATH resolution, with proper escaping
  await execFileAsync(shell, ["-ilc", `${command} ${shellEscape(path)}`], {
    timeout: 10_000,
  });
}
