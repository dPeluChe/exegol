import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const IDE_COMMANDS: Record<string, string> = {
  vscode: "code",
  cursor: "cursor",
  zed: "zed",
  windsurf: "windsurf",
};

function shellEscape(s: string): string {
  return `'${s.replace(/'/g, "'\\''")}'`;
}

export async function openInIde(
  path: string,
  ide: string,
  customPath?: string,
  line?: number,
): Promise<void> {
  const shell = process.env.SHELL || "/bin/zsh";

  if (ide === "custom" && customPath) {
    await execFileAsync(shell, ["-ilc", `${shellEscape(customPath)} ${shellEscape(path)}`], {
      timeout: 10_000,
    });
    return;
  }

  const command = IDE_COMMANDS[ide];
  if (!command) throw new Error(`Unknown IDE: ${ide}. Configure a custom IDE in Settings.`);

  // vscode-family CLIs jump to a line via `--goto file:line`; zed takes `file:line` bare.
  const targetArg = line
    ? ide === "zed"
      ? shellEscape(`${path}:${line}`)
      : `--goto ${shellEscape(`${path}:${line}`)}`
    : shellEscape(path);

  try {
    await execFileAsync(shell, ["-ilc", `${command} ${targetArg}`], {
      timeout: 10_000,
    });
  } catch (err) {
    throw new Error(
      `Failed to open ${ide} (${command}). Make sure it's installed and the CLI command is available. Error: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}
