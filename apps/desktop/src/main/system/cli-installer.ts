import { existsSync, lstatSync, mkdirSync, rmSync, symlinkSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { app } from "electron";

/**
 * T155.6 — install the `exegol` CLI opener as a symlink on PATH.
 *
 * Preferred target is /usr/local/bin (usually user-writable on macOS via
 * Homebrew ownership); falls back to ~/.local/bin when not writable.
 */

const CLI_NAME = "exegol";

export function getCliScriptPath(): string {
  // Packaged: shipped via electron-builder extraResources → Resources/bin/.
  // Dev: the script lives in the repo at apps/desktop/resources/bin/.
  return app.isPackaged
    ? join(process.resourcesPath, "bin", CLI_NAME)
    : join(app.getAppPath(), "resources", "bin", CLI_NAME);
}

function installCandidates(): string[] {
  return [join("/usr/local/bin", CLI_NAME), join(homedir(), ".local", "bin", CLI_NAME)];
}

function isSymlink(target: string): boolean {
  try {
    return lstatSync(target).isSymbolicLink();
  } catch {
    return false;
  }
}

function targetExists(target: string): boolean {
  try {
    lstatSync(target);
    return true;
  } catch {
    return false;
  }
}

/** Symlink the CLI script onto PATH. Returns the installed target path. */
export function installCli(): string {
  const script = getCliScriptPath();
  if (!existsSync(script)) {
    throw new Error(`CLI script not found at ${script}`);
  }
  const errors: string[] = [];
  for (const target of installCandidates()) {
    try {
      // Replace stale symlinks, but never delete a real user binary.
      if (targetExists(target)) {
        if (!isSymlink(target)) {
          errors.push(`${target}: exists and is not a symlink`);
          continue;
        }
        rmSync(target);
      }
      mkdirSync(dirname(target), { recursive: true });
      symlinkSync(script, target);
      return target;
    } catch (err) {
      errors.push(`${target}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  throw new Error(`Could not install the exegol CLI:\n${errors.join("\n")}`);
}

/** Remove the CLI symlink from all known locations. Returns removed paths. */
export function uninstallCli(): string[] {
  const removed: string[] = [];
  for (const target of installCandidates()) {
    if (!isSymlink(target)) continue;
    rmSync(target);
    removed.push(target);
  }
  return removed;
}
