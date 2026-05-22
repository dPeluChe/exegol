import { detectGhCli, execFileAsync } from "./diff-helpers";

export interface GitState {
  branch: string;
  hasUpstream: boolean;
  ahead: number;
  behind: number;
  dirtyStaged: number;
  dirtyUnstaged: number;
  conflicts: number;
  pr: {
    state: "none" | "open" | "merged" | "closed";
    url?: string;
    mergeable?: boolean;
    mergeStateStatus?: string;
  };
  ghInstalled: boolean;
}

export async function buildGitState(cwd: string): Promise<GitState> {
  const branch = await execFileAsync("git", ["branch", "--show-current"], { cwd })
    .then(({ stdout }) => stdout.trim())
    .catch(() => "unknown");

  // Upstream + ahead/behind
  let hasUpstream = false;
  let ahead = 0;
  let behind = 0;
  try {
    const { stdout: trackingRaw } = await execFileAsync(
      "git",
      ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"],
      { cwd },
    );
    if (trackingRaw.trim()) {
      hasUpstream = true;
      const { stdout: counts } = await execFileAsync(
        "git",
        ["rev-list", "--left-right", "--count", "HEAD...@{u}"],
        { cwd },
      );
      const [a, b] = counts.trim().split(/\s+/);
      ahead = Number.parseInt(a ?? "0", 10) || 0;
      behind = Number.parseInt(b ?? "0", 10) || 0;
    }
  } catch {
    /* no upstream configured yet */
  }

  // Status: dirty counts + conflicts
  let dirtyStaged = 0;
  let dirtyUnstaged = 0;
  let conflicts = 0;
  try {
    const { stdout } = await execFileAsync("git", ["status", "--porcelain=v1", "-uall"], {
      cwd,
      maxBuffer: 1024 * 1024,
    });
    for (const line of stdout.split("\n").filter(Boolean)) {
      const index = line[0];
      const work = line[1];
      // Unmerged markers — see git-status(1) porcelain output
      if (
        index === "U" ||
        work === "U" ||
        (index === "D" && work === "D") ||
        (index === "A" && work === "A")
      ) {
        conflicts++;
        continue;
      }
      if (index && index !== " " && index !== "?") dirtyStaged++;
      if ((work && work !== " " && work !== "?") || index === "?") dirtyUnstaged++;
    }
  } catch {
    /* ignore */
  }

  // GitHub PR state (optional; only if gh is installed)
  const ghInstalled = await detectGhCli();
  let pr: GitState["pr"] = { state: "none" };
  if (ghInstalled && branch !== "unknown" && branch !== "main" && branch !== "master") {
    try {
      const { stdout } = await execFileAsync(
        "gh",
        ["pr", "view", "--json", "state,url,mergeable,mergeStateStatus"],
        { cwd, timeout: 5000 },
      );
      const parsed = JSON.parse(stdout) as {
        state: string;
        url: string;
        mergeable: string;
        mergeStateStatus: string;
      };
      pr = {
        state: (parsed.state?.toLowerCase() as GitState["pr"]["state"]) ?? "none",
        url: parsed.url,
        mergeable: parsed.mergeable === "MERGEABLE",
        mergeStateStatus: parsed.mergeStateStatus,
      };
    } catch {
      // No PR for this branch — treat as "none"
    }
  }

  return {
    branch,
    hasUpstream,
    ahead,
    behind,
    dirtyStaged,
    dirtyUnstaged,
    conflicts,
    pr,
    ghInstalled,
  };
}
