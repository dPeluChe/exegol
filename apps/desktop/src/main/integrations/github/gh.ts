import { execFileAsync } from "../../lib/exec-file";

let ghFound = false;
export async function detectGhCli(): Promise<boolean> {
  if (ghFound) return true;
  // A miss is not cached: before the login-shell PATH lands, a Homebrew gh is invisible
  try {
    await execFileAsync("gh", ["--version"], { timeout: 3000 });
    ghFound = true;
    return true;
  } catch {
    return false;
  }
}

export async function currentBranch(cwd: string): Promise<string | null> {
  return execFileAsync("git", ["branch", "--show-current"], { cwd })
    .then(({ stdout }) => stdout.trim() || null)
    .catch(() => null);
}

/** Nothing to open a PR from: the project's default branch, or main/master */
export function isDefaultBranch(branch: string, defaultBranch: string): boolean {
  return branch === defaultBranch || branch === "main" || branch === "master";
}
