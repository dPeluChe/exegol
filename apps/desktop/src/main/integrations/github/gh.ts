import { execFileAsync } from "../../lib/exec-file";

const MISS_TTL_MS = 60_000;

/** A miss is kept 60 s, and only while PATH is the one it was checked with: the login-shell
 *  PATH landing (a Homebrew gh) asks again at once */
export function createGhDetector(probe: () => Promise<unknown>, now = Date.now) {
  let found = false;
  let miss: { at: number; path: string | undefined } | null = null;
  let inFlight: Promise<boolean> | null = null;
  return (): Promise<boolean> => {
    if (found) return Promise.resolve(true);
    if (miss && miss.path === process.env.PATH && now() - miss.at < MISS_TTL_MS) {
      return Promise.resolve(false);
    }
    inFlight ??= (async () => {
      const path = process.env.PATH;
      try {
        await probe();
        found = true;
        miss = null;
      } catch {
        miss = { at: now(), path };
      }
      return found;
    })().finally(() => {
      inFlight = null;
    });
    return inFlight;
  };
}

export const detectGhCli = createGhDetector(() =>
  execFileAsync("gh", ["--version"], { timeout: 3000 }),
);

export async function currentBranch(cwd: string): Promise<string | null> {
  return execFileAsync("git", ["branch", "--show-current"], { cwd })
    .then(({ stdout }) => stdout.trim() || null)
    .catch(() => null);
}

/** Nothing to open a PR from: the project's default branch, or main/master */
export function isDefaultBranch(branch: string, defaultBranch: string): boolean {
  return branch === defaultBranch || branch === "main" || branch === "master";
}
