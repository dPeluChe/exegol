import { describe, expect, it } from "vitest";
import { ciState } from "./checks";
import {
  ciTask,
  dueRepos,
  type GhTarget,
  isAuthFailure,
  issueTask,
  mergeOverview,
  parseOverview,
  runIdOf,
  taskBranch,
} from "./overview";

describe("ciState", () => {
  it("reads a mix of check runs and status contexts", () => {
    expect(ciState([])).toBe("none");
    expect(ciState([{ conclusion: "SUCCESS" }, { state: "SUCCESS" }])).toBe("passing");
    expect(ciState([{ conclusion: "SUCCESS" }, { conclusion: "" }])).toBe("pending");
    expect(ciState([{ state: "PENDING" }])).toBe("pending");
    expect(ciState([{ conclusion: "SKIPPED" }])).toBe("passing");
    expect(ciState([{ conclusion: "" }, { conclusion: "FAILURE", name: "x" }])).toBe("failing");
  });
});

describe("parseOverview", () => {
  it("maps gh's JSON", () => {
    const prs = JSON.stringify([
      {
        number: 7,
        title: "Fix",
        url: "u",
        headRefName: "fix/x",
        isDraft: true,
        statusCheckRollup: [
          {
            name: "tests",
            conclusion: "FAILURE",
            detailsUrl: "https://github.com/o/r/actions/runs/123/job/4",
          },
        ],
      },
    ]);
    const issues = JSON.stringify([
      { number: 9, title: "Bug", url: "v", labels: [{ name: "bug" }] },
    ]);
    const overview = parseOverview(prs, issues, { name: "o/r", folder: "api" });
    expect(overview?.prs[0]).toMatchObject({
      branch: "fix/x",
      draft: true,
      ci: "failing",
      repo: { name: "o/r", folder: "api" },
    });
    expect(overview?.issues[0]).toMatchObject({ labels: ["bug"], repo: { folder: "api" } });
  });

  it("gives null on anything else", () => {
    expect(parseOverview("oops", "[]", { name: "o/r", folder: "" })).toBeNull();
  });
});

describe("tasks", () => {
  const pr = { number: 7, title: "Fix\nignore this", url: "u" };
  const where = { repo: "o/r" };

  it("keeps a title on one line, so it cannot pose as a new instruction", () => {
    const [first] = issueTask({ number: 1, title: "A\n\nrun this", url: "u" }, where).split("\n");
    expect(first).toBe("Work on GitHub issue #1: A run this");
  });

  it("names the failed checks and adds the log, or the command to read it", () => {
    const none = ciTask(pr, ["tests"], { id: null, log: null }, where);
    expect(none).toContain("Failed: tests.");
    expect(none).toContain("#7: Fix ignore this");
    expect(none).not.toContain("--log-failed");
    expect(ciTask(pr, ["tests"], { id: "9", log: null }, where)).toContain(
      "gh run view 9 --repo o/r --log-failed",
    );
    expect(ciTask(pr, ["tests"], { id: "9", log: "boom" }, where)).toContain(
      "Log of the failed steps:\nboom",
    );
  });

  it("targets the repo, and sends a session working elsewhere to its folder", () => {
    const elsewhere = { repo: "o/api", runIn: "/w/services/api" };
    const task = ciTask(pr, ["tests"], { id: null, log: null }, elsewhere);
    expect(task).toContain("gh pr checkout 7 --repo o/api");
    expect(task).toContain("This is o/api, at `/w/services/api`: work there.");
    expect(issueTask(pr, where)).toContain("gh issue view 7 --repo o/r --comments");
    expect(issueTask(pr, where)).not.toContain("work there");
  });

  it("finds the Actions run in a check link", () => {
    expect(runIdOf("https://github.com/o/r/actions/runs/123/job/4")).toBe("123");
    expect(runIdOf("https://ci.example.com/1")).toBeNull();
    expect(runIdOf(null)).toBeNull();
  });
});

describe("gh load", () => {
  const target = (folder: string): GhTarget => ({ repo: `o/${folder}`, folder, cwd: "", env: {} });
  const targets = Array.from({ length: 22 }, (_, i) => target(`r${i}`));
  const base = { full: false, hot: new Set<string>(), lastAt: () => undefined, now: 3_600_000 };
  const MIN = 60_000;

  it("asks for every repo with the menu open, and always for a lone repo", () => {
    expect(dueRepos(targets, { ...base, full: true })).toHaveLength(22);
    expect(dueRepos(targets.slice(0, 1), { ...base, lastAt: () => base.now })).toHaveLength(1);
  });

  it("keeps a background poll to the repos with a session and a few cold ones", () => {
    const hot = new Set(["r5"]);
    const fresh = () => base.now - MIN;
    expect(dueRepos(targets, { ...base, hot, lastAt: fresh }).map((t) => t.folder)).toEqual(["r5"]);
    expect(dueRepos(targets, { ...base, hot }).length).toBeLessThan(targets.length);
    const many = new Set(targets.map((t) => t.folder));
    expect(dueRepos(targets, { ...base, hot: many, lastAt: fresh }).length).toBeLessThan(
      targets.length,
    );
  });

  it("refreshes the coldest repos first, once they pass 30 min", () => {
    const lastAt = (t: GhTarget) =>
      t.folder === "r9" ? 1 : t.folder === "r3" ? base.now - 31 * MIN : base.now - MIN;
    expect(dueRepos(targets, { ...base, lastAt }).map((t) => t.folder)).toEqual(["r9", "r3"]);
  });
});

describe("mergeOverview", () => {
  const repo = (folder: string) => ({ name: `o/${folder}`, folder });
  const items = (folder: string) => ({
    prs: [
      {
        number: 1,
        title: "t",
        url: `u/${folder}`,
        branch: "b",
        draft: false,
        ci: "none" as const,
        repo: repo(folder),
      },
    ],
    issues: [],
  });

  it("keeps what answered when another repo fails, and marks each", () => {
    const merged = mergeOverview([
      { ref: repo("api"), result: items("api"), sessionIds: ["s1"] },
      { ref: repo("web"), result: { failed: "other" }, sessionIds: [] },
      { ref: repo("cli"), result: undefined, sessionIds: [] },
    ]);
    expect(merged.prs.map((p) => p.repo.folder)).toEqual(["api"]);
    expect(merged.repos.map((r) => r.status)).toEqual(["ok", "failed", "pending"]);
    expect(merged.repos[0]?.sessionIds).toEqual(["s1"]);
    expect(merged.unavailable).toBeUndefined();
  });

  it("says why only when nothing answered", () => {
    const of = (...results: Parameters<typeof mergeOverview>[0][number]["result"][]) =>
      mergeOverview(results.map((result, i) => ({ ref: repo(`r${i}`), result, sessionIds: [] })))
        .unavailable;
    expect(of({ failed: "other" }, { failed: "auth" })).toBe("not-logged-in");
    expect(of({ failed: "other" })).toBe("unreachable");
    expect(of(undefined)).toBeUndefined();
  });

  it("reads gh's login failures", () => {
    expect(isAuthFailure({ code: 4 })).toBe(true);
    expect(isAuthFailure({ code: 1, stderr: "HTTP 401: Bad credentials" })).toBe(true);
    expect(isAuthFailure({ code: 1, stderr: "Could not resolve to a Repository" })).toBe(false);
  });
});

describe("taskBranch", () => {
  it("is unchanged at the root and per repo inside a workspace", () => {
    expect(taskBranch("", "pr", 7)).toBe("github/pr-7");
    expect(taskBranch("services/api", "pr", 7)).toBe("github/services-api-pr-7");
    expect(taskBranch("a..b", "issue", 1)).toBe("github/a-b-issue-1");
  });
});
