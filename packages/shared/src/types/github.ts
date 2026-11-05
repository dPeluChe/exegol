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

export type GitHubPr = {
  number: number;
  title: string;
  url: string;
  branch: string;
  draft: boolean;
  ci: GitHubCi;
};

export type GitHubOpenIssue = Pick<GitHubIssue, "number" | "title" | "url" | "labels">;

export type GitHubOverview = { prs: GitHubPr[]; issues: GitHubOpenIssue[] };

/** A PR or issue to hand to a session; `fixCi` adds the failed check's log */
export type GitHubTaskRef = { kind: "pr" | "issue"; number: number; fixCi?: boolean };
