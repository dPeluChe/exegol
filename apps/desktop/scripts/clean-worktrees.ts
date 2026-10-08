// clean:build worktrees section: `git worktree prune` and orphaned `.claude/worktrees/agent-*`.
// Removes only what worktreeSafety allows, with a plain `git worktree remove` so git checks
// again; never branches, never the main checkout or the checkout running this script.
import { existsSync, lstatSync, readdirSync, realpathSync, rmdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { ALWAYS_CHANGED, runGit, worktreeSafety } from "../src/main/lib/worktree-safety";
import {
  AGENT_WORKTREE_DIR,
  agentWorktreeAction,
  cwdInside,
  parseWorktreeList,
  prVerdict,
} from "./clean-build-plan";
import { duBytes, human, run } from "./clean-exec";

const REMOVE_TIMEOUT_MS = 120_000;

const real = (p: string) => {
  try {
    return realpathSync(p);
  } catch {
    return p;
  }
};

const git = (args: string[], cwd: string, timeoutMs?: number) =>
  runGit(args, cwd, timeoutMs).catch(() => null);

function prStates(main: string, branch: string): string[] | null {
  const out = run(
    "gh",
    ["pr", "list", "--head", branch, "--state", "all", "--json", "state"],
    [0],
    main,
  );
  if (out === null) return null;
  try {
    return (JSON.parse(out) as { state: string }[]).map((p) => p.state);
  } catch {
    return null;
  }
}

export async function worktreeSection(root: string, apply: boolean): Promise<number> {
  console.log("\nworktrees (--repo-only skips this; branches are never deleted)");
  const common = await git(["rev-parse", "--path-format=absolute", "--git-common-dir"], root);
  if (common === null) {
    console.log("  git unavailable, skipped");
    return 0;
  }
  const main = dirname(common.trim());

  const prune = await git(["worktree", "prune", "-v", ...(apply ? [] : ["--dry-run"])], main);
  for (const line of (prune ?? "").split("\n").filter(Boolean)) {
    console.log(`  ${apply ? "pruned" : "would prune"}: ${line}`);
  }

  const list = parseWorktreeList((await git(["worktree", "list", "--porcelain"], main)) ?? "");
  const byPath = new Map(list.map((w) => [real(w.path), w]));
  const base = join(main, ".claude/worktrees");
  let names: string[] = [];
  try {
    names = readdirSync(base).filter((n) => AGENT_WORKTREE_DIR.test(n));
  } catch {
    /* no agent worktrees */
  }
  if (names.length === 0) console.log("  no agent worktrees");
  // A shell or agent sitting in a worktree keeps it; no lsof answer keeps them all
  const cwds = run("lsof", ["-a", "-d", "cwd", "-Fn"], [0, 1]);
  let freed = 0;
  for (const name of names) {
    const dir = join(base, name);
    if (!lstatSync(dir, { throwIfNoEntry: false })?.isDirectory()) continue;
    if (real(dir) === real(root)) {
      console.log(`  skip ${name} (this checkout)`);
      continue;
    }
    const reg = byPath.get(real(dir));
    const pr = reg && !reg.locked && reg.branch ? prVerdict(prStates(main, reg.branch)) : null;
    const { action, note } = agentWorktreeAction(reg, pr);
    if (action !== "candidate") {
      const size = action === "report" ? ` ${human(duBytes(dir) ?? 0)}` : "";
      console.log(`  ${action} ${name}${size} (${note})`);
      continue;
    }
    if (cwds === null || cwdInside(cwds, real(dir)) || cwdInside(cwds, dir)) {
      console.log(`  keep ${name} (${cwds === null ? "lsof failed" : "a process runs in it"})`);
      continue;
    }
    const size = duBytes(dir) ?? 0;
    const safety = await worktreeSafety(dir);
    if (!safety.removable) {
      console.log(`  report ${name} ${human(size)}: ${note}, kept (${safety.reason})`);
      continue;
    }
    if (!apply) {
      console.log(`  would remove ${name} ${human(size)}: ${note}`);
      freed += size;
      continue;
    }
    // Restore only the always-deleted file, so the plain remove (git re-checks) accepts the tree
    await git(["checkout", "--", ALWAYS_CHANGED], dir);
    if ((await git(["worktree", "remove", dir], main, REMOVE_TIMEOUT_MS)) === null) {
      console.log(`  skip ${name} (git worktree remove refused or failed)`);
      continue;
    }
    // Finder's .DS_Store keeps the folder after git removed everything it knew
    if (existsSync(dir)) {
      rmSync(join(dir, ".DS_Store"), { force: true });
      try {
        rmdirSync(dir);
      } catch {
        console.log(`  ${name}: leftovers kept (not empty)`);
      }
    }
    console.log(`  removed ${name} ${human(size)}: ${note}`);
    freed += size;
  }
  return freed;
}
