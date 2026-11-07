import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

export async function ghSignedIn(): Promise<boolean> {
  try {
    await execFileAsync("gh", ["auth", "status"], { timeout: 5_000 });
    return true;
  } catch {
    return false;
  }
}

/** The body goes through a private temp file: it can be long and must not show in a process list */
export async function ghCreateIssue(repo: string, title: string, body: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "exegol-issue-"));
  try {
    const file = join(dir, "body.md");
    await writeFile(file, body, { mode: 0o600 });
    const { stdout } = await execFileAsync(
      "gh",
      ["issue", "create", "--repo", repo, "--title", title, "--body-file", file],
      { timeout: 30_000 },
    );
    return stdout.trim().split("\n").pop() ?? "";
  } finally {
    await rm(dir, { recursive: true, force: true });
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
