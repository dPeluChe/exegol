import {
  chmodSync,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
} from "node:fs";
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

function getCliScriptPath(): string {
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

/** A copy we installed (from an AppImage): the opener's own header line */
function isOurCopy(target: string): boolean {
  try {
    return readFileSync(target, "utf8").includes("# Exegol CLI opener");
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
        if (!isSymlink(target) && !isOurCopy(target)) {
          errors.push(`${target}: exists and is not a symlink`);
          continue;
        }
        rmSync(target);
      }
      mkdirSync(dirname(target), { recursive: true });
      // An AppImage's files live in a mount that is gone once it quits: a symlink into it broke
      if (process.env.APPIMAGE) {
        copyFileSync(script, target);
        chmodSync(target, 0o755);
      } else {
        symlinkSync(script, target);
      }
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
    if (!isSymlink(target) && !isOurCopy(target)) continue;
    rmSync(target);
    removed.push(target);
  }
  return removed;
}
