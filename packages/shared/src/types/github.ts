export type GitHubIssue = {
  number: number;
  title: string;
  body: string | null;
  state: "open" | "closed";
  labels: string[];
  assignees: string[];
  url: string;
  createdAt: string;
  updatedAt: string;
};

export type GitHubCi = "failing" | "pending" | "passing" | "none";

/** A repo of a project: `name` is owner/repo, `folder` is relative to the project ("" the root) */
export type GitHubRepoRef = { name: string; folder: string };

export type GitHubPr = {
  number: number;
  title: string;
  url: string;
  branch: string;
  draft: boolean;
  ci: GitHubCi;
  repo: GitHubRepoRef;
};

export type GitHubOpenIssue = Pick<GitHubIssue, "number" | "title" | "url" | "labels"> & {
  repo: GitHubRepoRef;
};

/** `pending`: not asked yet, opening the menu asks. `sessionIds`: live sessions working in it */
export type GitHubRepoStatus = GitHubRepoRef & {
  status: "ok" | "failed" | "pending";
  sessionIds: string[];
};

export type GitHubUnavailable = "no-gh" | "not-logged-in" | "no-remote" | "unreachable";

export type GitHubOverview = {
  prs: GitHubPr[];
  issues: GitHubOpenIssue[];
  repos: GitHubRepoStatus[];
  /** Why there is nothing to show; absent while any repo answers */
  unavailable?: GitHubUnavailable;
};

/** A PR or issue to hand to a session; `fixCi` adds the failed check's log. `repo` is required
 *  by main when the project holds more than one */
export type GitHubTaskRef = {
  kind: "pr" | "issue";
  number: number;
  fixCi?: boolean;
  repo?: GitHubRepoRef;
};
