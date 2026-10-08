// clean:build worktrees section: `git worktree prune` and orphaned `.claude/worktrees/agent-*`.
// Removes only what worktreeSafety allows (clean, nothing unpushed); never branches, never the
// main checkout or the checkout running this script.
import { existsSync, lstatSync, readdirSync, realpathSync, rmdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { worktreeSafety } from "../src/main/lib/worktree-safety";
import { AGENT_WORKTREE_DIR, parseWorktreeList, prVerdict } from "./clean-build-plan";
import { duBytes, human, run } from "./clean-exec";

const real = (p: string) => {
  try {
    return realpathSync(p);
  } catch {
    return p;
  }
};

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

/** Why this agent worktree is an orphan, or null when it is not (or that is unknown) */
function orphanReason(
  main: string,
  registered: { branch: string | null; locked: boolean } | undefined,
): { orphan: string | null; note: string } {
  if (!registered) return { orphan: "not a registered worktree", note: "" };
  if (registered.locked) return { orphan: null, note: "locked" };
  if (!registered.branch) return { orphan: null, note: "detached HEAD, PR unknown" };
  const verdict = prVerdict(prStates(main, registered.branch));
  if (verdict === "done")
    return { orphan: `PR of ${registered.branch} merged or closed`, note: "" };
  const note = {
    unknown: "PR state unknown (gh missing or offline)",
    open: "PR open",
    none: "no PR",
  };
  return { orphan: null, note: `${registered.branch}: ${note[verdict]}` };
}

export async function worktreeSection(root: string, apply: boolean): Promise<number> {
  console.log("\nworktrees (--repo-only skips this; branches are never deleted)");
  const common = run("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], [0], root);
  if (common === null) {
    console.log("  git unavailable, skipped");
    return 0;
  }
  const main = dirname(common.trim());

  const prune = run("git", ["worktree", "prune", "-v", ...(apply ? [] : ["--dry-run"])], [0], main);
  for (const line of (prune ?? "").split("\n").filter(Boolean)) {
    console.log(`  ${apply ? "pruned" : "would prune"}: ${line}`);
  }

  const list = parseWorktreeList(run("git", ["worktree", "list", "--porcelain"], [0], main) ?? "");
  const byPath = new Map(list.map((w) => [real(w.path), w]));
  const base = join(main, ".claude/worktrees");
  let names: string[] = [];
  try {
    names = readdirSync(base).filter((n) => AGENT_WORKTREE_DIR.test(n));
  } catch {
    /* no agent worktrees */
  }
  let freed = 0;
  for (const name of names) {
    const dir = join(base, name);
    if (!lstatSync(dir, { throwIfNoEntry: false })?.isDirectory()) continue;
    if (real(dir) === real(root)) {
      console.log(`  skip ${name} (this checkout)`);
      continue;
    }
    const { orphan, note } = orphanReason(main, byPath.get(real(dir)));
    if (!orphan) {
      console.log(`  keep ${name} (${note})`);
      continue;
    }
    const size = duBytes(dir) ?? 0;
    const safety = await worktreeSafety(dir);
    if (!safety.removable) {
      console.log(`  report ${name} ${human(size)}: ${orphan}, kept (${safety.reason})`);
      continue;
    }
    if (!apply) {
      console.log(`  would remove ${name} ${human(size)}: ${orphan}`);
      freed += size;
      continue;
    }
    if (run("git", ["worktree", "remove", "--force", dir], [0], main) === null) {
      console.log(`  skip ${name} (git worktree remove failed)`);
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
    console.log(`  removed ${name} ${human(size)}: ${orphan}`);
    freed += size;
  }
  if (names.length === 0) console.log("  no agent worktrees");
  return freed;
}
