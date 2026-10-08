import { describe, expect, it } from "vitest";
import {
  agentWorktreeAction,
  cwdInside,
  parseWorktreeList,
  planDist,
  planIncremental,
  planTestTmp,
  planTurbo,
  prVerdict,
  saveCommands,
} from "./clean-build-plan";

const at = (name: string, mtimeMs = 0) => ({ name, mtimeMs });

describe("planDist", () => {
  const dirs = ["0.5.9", "0.5.10", "0.5.11", "0.5.12", "0.5.16", "notes", "mac-arm64"].map((n) =>
    at(n),
  );

  it("keeps the newest N by semver, the current one among them", () => {
    expect(planDist(dirs, "0.5.16", 2).sort()).toEqual(["0.5.10", "0.5.11", "0.5.9"]);
  });

  it("never removes the current version, even when it is not among the newest", () => {
    expect(planDist(dirs, "0.5.9", 1)).not.toContain("0.5.9");
  });

  it("keeps only the newest -local test build by date", () => {
    const locals = [at("0.5.16-local", 3), at("0.5.15-local", 1), at("0.5.16-local.2", 2)];
    expect(planDist(locals, "0.5.16", 2).sort()).toEqual(["0.5.15-local", "0.5.16-local.2"]);
  });

  it("orders prerelease parts numerically", () => {
    const pre = ["0.6.0-beta.2", "0.6.0-beta.10", "0.6.0-beta.9", "0.6.0"].map((n) => at(n));
    expect(planDist(pre, "0.6.0", 2).sort()).toEqual(["0.6.0-beta.2", "0.6.0-beta.9"]);
  });

  it("ignores names that are not versions", () => {
    expect(planDist([at("latest"), at("0.5")], "0.5.16", 0)).toEqual([]);
  });
});

describe("planTurbo", () => {
  it("removes a hash's files together, only when all are older than the cutoff", () => {
    const files = [
      at("0123456789abcdef.tar.zst", 1),
      at("0123456789abcdef-meta.json", 1),
      at("fedcba9876543210.tar.zst", 1),
      at("fedcba9876543210-meta.json", 50),
      at("daemon.log", 1),
    ];
    expect(planTurbo(files, 10)).toEqual([
      "0123456789abcdef.tar.zst",
      "0123456789abcdef-meta.json",
    ]);
  });
});

describe("planIncremental", () => {
  it("only old crate-hash dirs", () => {
    const dirs = [
      at("exegol_core_rust-0jpkubmnsuar9", 1),
      at("build_script_build-2t", 50),
      at("..", 1),
    ];
    expect(planIncremental(dirs, 10)).toEqual(["exegol_core_rust-0jpkubmnsuar9"]);
  });
});

describe("worktrees", () => {
  it("parses git worktree list --porcelain", () => {
    const text =
      "worktree /r\nHEAD 1\nbranch refs/heads/main\n\nworktree /r/.claude/worktrees/agent-a\nHEAD 2\ndetached\nlocked claude\n\nworktree /r/w\nHEAD 3\nbranch refs/heads/feat/x\n";
    expect(parseWorktreeList(text)).toEqual([
      { path: "/r", branch: "main", locked: false },
      { path: "/r/.claude/worktrees/agent-a", branch: null, locked: true },
      { path: "/r/w", branch: "feat/x", locked: false },
    ]);
  });

  it("an unregistered folder is report only; locked, open or unknown PRs are kept", () => {
    const reg = { branch: "feat/x", locked: false };
    expect(agentWorktreeAction(undefined, null).action).toBe("report");
    expect(agentWorktreeAction({ ...reg, locked: true }, null).action).toBe("keep");
    expect(agentWorktreeAction(reg, "unknown").action).toBe("keep");
    expect(agentWorktreeAction(reg, "open").action).toBe("keep");
    expect(agentWorktreeAction(reg, "done").action).toBe("candidate");
  });

  it("matches a process cwd in the folder or below, not a sibling prefix", () => {
    const out = "p1\nn/r/.claude/worktrees/agent-a/apps\np2\nn/r/.claude/worktrees/agent-ab\n";
    expect(cwdInside(out, "/r/.claude/worktrees/agent-a")).toBe(true);
    expect(cwdInside(out, "/r/.claude/worktrees/agent-b")).toBe(false);
    expect(
      cwdInside("p1\nn/r/.claude/worktrees/agent-abc\n", "/r/.claude/worktrees/agent-ab"),
    ).toBe(false);
  });

  it("prints save commands only for uncommitted or unpushed work on a branch", () => {
    expect(saveCommands("/w/a", "feat/x", "unpushed commits")).toBe(
      "git -C '/w/a' push -u origin 'feat/x'",
    );
    expect(saveCommands("/w/a", "feat/x", "uncommitted changes")).toContain("add -A");
    expect(saveCommands("/w/a", null, "uncommitted changes")).toBeNull();
    expect(saveCommands("/w/a", "feat/x", "submodules")).toBeNull();
  });

  it("only a merged or closed PR, with none open, makes an orphan", () => {
    expect(prVerdict(null)).toBe("unknown");
    expect(prVerdict([])).toBe("none");
    expect(prVerdict(["CLOSED", "OPEN"])).toBe("open");
    expect(prVerdict(["MERGED"])).toBe("done");
    expect(prVerdict(["CLOSED"])).toBe("done");
  });
});

describe("planTestTmp", () => {
  it("only the test suites' mkdtemp dirs, never the app's own temp files", () => {
    const dirs = [
      at("exegol-history-AbC123", 1),
      at("exegol-run-refresh-x1y2z3", 1),
      at("exegol-skill-AbC123", 1),
      at("exegol-pipeline-index-AbC123", 1),
      at("exegol-test-logs", 1),
      at("exegol-history-AbC123", 50),
      at("exegol-history-toolong1", 1),
    ];
    expect(planTestTmp(dirs, 10)).toEqual(["exegol-history-AbC123", "exegol-run-refresh-x1y2z3"]);
  });
});
