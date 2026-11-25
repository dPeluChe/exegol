import { type ExecFileOptions, exec, execSync } from "node:child_process";
import { accessSync, constants, existsSync, statSync } from "node:fs";
import { homedir, userInfo } from "node:os";
import { delimiter, join } from "node:path";
import { execFileAsync } from "../lib/exec-file";
import { launchFor } from "../lib/win-launch";
import { COMMAND_ALIASES } from "./cli-catalog";
import { windowsShell } from "./shell-dialect";

const SHELL_PATH_TIMEOUT_MS = 5_000;

// ─── Shell PATH resolution ──────────────────────────────────────────────

/** The login shell: $SHELL, else the account's, else the platform default (zsh is macOS's, not
 *  Linux's). Windows has none: PowerShell, else cmd.exe ($SHELL there is often an MSYS path
 *  ConPTY cannot start) */
export function loginShell(): string {
  if (process.platform === "win32") return windowsShell(process.env, findOnPath);
  let account = "";
  try {
    account = userInfo().shell ?? "";
  } catch {
    /* no passwd entry */
  }
  return process.env.SHELL || account || (process.platform === "darwin" ? "/bin/zsh" : "/bin/bash");
}

const shellPathCommand = () => `${loginShell()} -ilc 'echo $PATH'`;

function getShellPath(): string {
  // A Windows app inherits the user's full PATH; there is no login shell to ask
  if (process.platform === "win32") return process.env.PATH ?? "";
  try {
    const result = execSync(shellPathCommand(), {
      encoding: "utf-8",
      timeout: SHELL_PATH_TIMEOUT_MS,
    }).trim();
    return result || fallbackPath();
  } catch {
    return fallbackPath();
  }
}

// A heavy rc file can blow the timeout; launchd's PATH alone hides every Homebrew CLI
function fallbackPath(): string {
  const home = homedir();
  const extra = [
    ...(process.platform === "darwin"
      ? ["/opt/homebrew/bin"]
      : ["/snap/bin", "/var/lib/flatpak/exports/bin"]),
    "/usr/local/bin",
    join(home, ".local/bin"),
    join(home, ".bun/bin"),
    join(home, ".cargo/bin"),
  ];
  const parts = (process.env.PATH || "").split(":").filter(Boolean);
  return [...new Set([...parts, ...extra])].join(":");
}

let resolvedPath: string | null = null;

/** Resolve the login-shell PATH off the main thread so the first spawn or Doctor run doesn't block on it. */
export function warmShellPath(): void {
  if (process.platform === "win32") return;
  exec(shellPathCommand(), { timeout: SHELL_PATH_TIMEOUT_MS }, (err, stdout) => {
    // Overwrites a sync fallback too: the real shell PATH wins whenever it arrives
    if (!err && stdout.trim()) {
      resolvedPath = stdout.trim();
      process.env.PATH = resolvedPath;
    }
  });
}

/** Whether `command` resolves to a file on the login shell's PATH: a stat per PATH dir, no
 *  process. Spawn launches what this finds, so the launcher's "installed" asks the same thing */
export function commandOnPath(command: string): boolean {
  return findOnPath(command) !== null;
}

/** A file that runs: `which` skipped folders and, off Windows, files without the exec bit */
function runnable(path: string): boolean {
  try {
    if (!statSync(path).isFile()) return false;
    if (process.platform !== "win32") accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/** Where `command` resolves on the login shell's PATH, or null */
export function findOnPath(command: string, searchPath = _getFullPath()): string | null {
  return findAllOnPath(command, searchPath)[0] ?? null;
}

/** Every copy of `command` on PATH, in PATH order (the first runs): one per folder, a stat each,
 *  no `which` (some Linux installs lack it) and no `where` */
export function findAllOnPath(command: string, searchPath = _getFullPath()): string[] {
  if (command.includes("/") || command.includes("\\")) {
    return existsSync(command) ? [command] : [];
  }
  // PATHEXT first: npm leaves a POSIX script with no extension beside its `.cmd`
  const exts =
    process.platform === "win32" ? [...(process.env.PATHEXT ?? ".EXE;.CMD").split(";"), ""] : [""];
  const hits: string[] = [];
  for (const dir of new Set(searchPath.split(delimiter))) {
    if (!dir) continue;
    const hit = exts.map((ext) => join(dir, command + ext)).find(runnable);
    if (hit) hits.push(hit);
  }
  return hits;
}

/** Runs a CLI on any system: on Windows it is found on PATH, and a `.cmd` goes through cmd.exe */
export function execCli(bin: string, argv: string[], options: ExecFileOptions) {
  const utf8 = { ...options, encoding: "utf8" as const };
  if (process.platform !== "win32") return execFileAsync(bin, argv, utf8);
  const found = findOnPath(bin) ?? bin;
  const { command, args, verbatim } = launchFor([found, ...argv], "win32", process.env.ComSpec);
  return execFileAsync(command, args, { ...utf8, windowsVerbatimArguments: verbatim });
}

/** The options a repo's hook script runs with: Windows' own shell, not cmd.exe unasked */
export const hookShell = () =>
  process.platform === "win32" ? { shell: loginShell(), windowsHide: true } : {};

/** The binary to launch for a provider command: itself, or the new name it moved to (kilo) */
export function resolveCommand(command: string): string {
  if (commandOnPath(command)) return command;
  return COMMAND_ALIASES[command]?.find(commandOnPath) ?? command;
}

// Adopted into process.env: main's own execs (gh, git, lsof) otherwise get launchd's PATH from Finder
export function _getFullPath(): string {
  if (!resolvedPath) {
    resolvedPath = getShellPath();
    process.env.PATH = resolvedPath;
  }
  return resolvedPath;
}
