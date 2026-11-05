import type { GitHubOverview, GitHubRepoStatus } from "@exegol/shared";
import { describe, expect, it } from "vitest";
import { groupByRepo, sessionsInRepoFirst } from "./github-repos";

const status = (folder: string, extra?: Partial<GitHubRepoStatus>): GitHubRepoStatus => ({
  name: `o/${folder}`,
  folder,
  status: "ok",
  sessionIds: [],
  ...extra,
});
const pr = (folder: string, number: number, ci: "failing" | "none", title = "Fix login") => ({
  number,
  title,
  url: `https://github.com/o/${folder}/pull/${number}`,
  branch: "b",
  draft: false,
  ci,
  repo: { name: `o/${folder}`, folder },
});
const issue = (folder: string, number: number) => ({
  number,
  title: "Broken header",
  url: `https://github.com/o/${folder}/issues/${number}`,
  labels: [],
  repo: { name: `o/${folder}`, folder },
});
const overview: GitHubOverview = {
  repos: [status("idle"), status("web"), status("api")],
  prs: [pr("web", 7, "none"), pr("api", 7, "failing", "Add rate limit")],
  issues: [issue("web", 8)],
};

describe("groupByRepo", () => {
  it("keeps same numbers apart, hides empty repos, failing CI first", () => {
    const groups = groupByRepo(overview, "");
    expect(groups.map((g) => g.repo.folder)).toEqual(["api", "web"]);
    expect(groups[1]?.prs.map((p) => p.repo.folder)).toEqual(["web"]);
  });

  it("filters by repo, keeping all of it, or by item", () => {
    const byRepo = groupByRepo(overview, "o/WEB");
    expect(byRepo.map((g) => [g.repo.folder, g.prs.length, g.issues.length])).toEqual([
      ["web", 1, 1],
    ]);
    const byTitle = groupByRepo(overview, "header");
    expect(byTitle.map((g) => [g.repo.folder, g.prs.length, g.issues.length])).toEqual([
      ["web", 0, 1],
    ]);
    expect(groupByRepo(overview, "#7").map((g) => g.repo.folder)).toEqual(["api", "web"]);
    expect(groupByRepo(overview, "nothing")).toEqual([]);
  });
});

describe("sessionsInRepoFirst", () => {
  it("moves the repo's sessions up and keeps the order", () => {
    const sessions = [{ id: "a" }, { id: "b" }, { id: "c" }];
    expect(sessionsInRepoFirst(sessions, ["c", "b"]).map((s) => s.id)).toEqual(["b", "c", "a"]);
  });
});
