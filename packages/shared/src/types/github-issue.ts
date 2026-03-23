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
