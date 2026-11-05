import type {
  GitHubOpenIssue,
  GitHubOverview,
  GitHubPr,
  GitHubRepoRef,
  GitHubRepoStatus,
  GitHubUnavailable,
} from "@exegol/shared";

export const UNAVAILABLE_TEXT: Record<GitHubUnavailable, { label: string; title: string }> = {
  "no-gh": { label: "No gh", title: "GitHub CLI (gh) is not installed" },
  "not-logged-in": { label: "Log in", title: "Not logged in: run gh auth login" },
  "no-remote": { label: "No remote", title: "No GitHub remote in this project" },
  unreachable: { label: "Offline", title: "GitHub did not answer" },
};

export const sameRepo = (a: GitHubRepoRef, b: GitHubRepoRef) =>
  a.folder === b.folder && a.name === b.name;

export type RepoGroup = { repo: GitHubRepoStatus; prs: GitHubPr[]; issues: GitHubOpenIssue[] };

const failingIn = (g: RepoGroup) => g.prs.filter((p) => p.ci === "failing").length;

/** Repos with open items, most urgent first. A filter on a repo keeps all of it, else the items
 *  whose title or number match */
export function groupByRepo(overview: GitHubOverview, filter: string): RepoGroup[] {
  const q = filter.trim().toLowerCase();
  const hit = (text: string) => text.toLowerCase().includes(q);
  const groups = overview.repos.map((repo): RepoGroup => {
    const mine = <T extends GitHubPr | GitHubOpenIssue>(items: T[]) =>
      items.filter((i) => sameRepo(i.repo, repo));
    const prs = mine(overview.prs);
    const issues = mine(overview.issues);
    if (!q || hit(repo.name) || hit(repo.folder)) return { repo, prs, issues };
    const matches = (i: GitHubPr | GitHubOpenIssue) => hit(i.title) || hit(`#${i.number}`);
    return { repo, prs: prs.filter(matches), issues: issues.filter(matches) };
  });
  return groups
    .filter((g) => g.prs.length + g.issues.length > 0)
    .sort(
      (a, b) =>
        failingIn(b) - failingIn(a) ||
        b.prs.length - a.prs.length ||
        b.issues.length - a.issues.length,
    );
}

/** Sessions working in the repo first, otherwise in the order given */
export function sessionsInRepoFirst<T extends { id: string }>(
  sessions: T[],
  inRepo: readonly string[],
): T[] {
  const inside = (s: T) => inRepo.includes(s.id);
  return [...sessions.filter(inside), ...sessions.filter((s) => !inside(s))];
}

/** The repos left out of a list, for its last line */
export function reposNotShown(repos: GitHubRepoStatus[]) {
  return {
    failed: repos.filter((r) => r.status === "failed"),
    pending: repos.filter((r) => r.status === "pending").length,
  };
}
