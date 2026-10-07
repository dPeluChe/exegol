import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { type IdeInfo, ideLabel } from "@exegol/shared";
import type Database from "libsql";
import { loginShell } from "../agents/spawn-env";
import { getProject } from "../db/queries/projects";
import { getAppSettings } from "../db/queries/settings";
import { IDE_LAUNCH, targetArgs } from "./catalog";
import { detectIdes } from "./detect";

const execFileAsync = promisify(execFile);

function shellEscape(s: string): string {
  return `'${s.replace(/'/g, "'\\''")}'`;
}

/** The project's IDE (Edit project), else the one in Settings */
export function resolveIde(db: Database.Database, projectId: string | null | undefined) {
  const settings = getAppSettings(db);
  const project = projectId ? getProject(db, projectId) : null;
  return {
    ide: project?.ide ?? settings.defaultIde ?? "vscode",
    customPath: settings.customIdePath ?? undefined,
  };
}

/** Terminal editors return the command for an Exegol terminal tab instead of running it */
export async function openInIde(
  path: string,
  ide: string,
  customPath?: string,
  line?: number,
): Promise<{ terminalCommand?: string }> {
  if (ide === "custom" && customPath) {
    await execFileAsync(loginShell(), ["-ilc", `${shellEscape(customPath)} ${shellEscape(path)}`], {
      timeout: 10_000,
    });
    return {};
  }
  if (!(ide in IDE_LAUNCH)) {
    throw new Error(`Unknown IDE: ${ide}. Configure a custom IDE in Settings.`);
  }
  const id = ide as IdeInfo["id"];
  const launcher = (await detectIdes()).get(id) ?? (await detectIdes(true)).get(id);
  const label = ideLabel(id);
  if (!launcher) throw new Error(`${label} is not installed (no app or command found).`);

  const target = launcher.line ? targetArgs(launcher.line, path, line) : [path];
  const argv = [...launcher.argv, ...target];
  if (IDE_LAUNCH[id].line === "vim") return { terminalCommand: argv.map(shellEscape).join(" ") };
  await launch(argv, label);
  return {};
}

/** Detached: a JetBrains script may stay up while the IDE runs. An exit within 3s is checked */
function launch(argv: string[], label: string): Promise<void> {
  const [command, ...args] = argv as [string, ...string[]];
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { detached: true, stdio: "ignore" });
    const timer = setTimeout(() => {
      child.unref();
      resolve();
    }, 3_000);
    child.once("error", (err) => {
      clearTimeout(timer);
      reject(new Error(`Failed to open ${label}: ${err.message}`));
    });
    child.once("exit", (code) => {
      clearTimeout(timer);
      if (code === 0 || code === null) resolve();
      else reject(new Error(`Failed to open ${label} (exit ${code}).`));
    });
  });
}
