import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type Database from "libsql";
import { loginShell } from "../agents/spawn-env";
import { getProject } from "../db/queries/projects";
import { getAppSettings } from "../db/queries/settings";

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

/** The user's IDE, else the project's, else VS Code */
export function resolveIde(db: Database.Database, projectId: string | null | undefined) {
  const settings = getAppSettings(db);
  const project = projectId ? getProject(db, projectId) : null;
  return {
    ide: settings.defaultIde ?? project?.defaultIde ?? "vscode",
    customPath: settings.customIdePath ?? undefined,
  };
}

export async function openInIde(
  path: string,
  ide: string,
  customPath?: string,
  line?: number,
): Promise<void> {
  const shell = loginShell();

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
