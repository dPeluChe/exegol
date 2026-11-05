import type { GitHubOverview, GitHubRepoRef } from "@exegol/shared";
import { CircleDot, GitPullRequest } from "lucide-react";
import type { ReactNode } from "react";

function Count({ title, tone, children }: { title: string; tone: string; children: ReactNode }) {
  return (
    <span
      title={title}
      className={`flex shrink-0 items-center gap-0.5 text-[9px] tabular-nums ${tone}`}
    >
      {children}
    </span>
  );
}

const plural = (n: number, word: string) => `${n} open ${word}${n === 1 ? "" : "s"}`;

/** One line per repo, only when a project has several behind the count */
function perRepo(items: { repo: GitHubRepoRef }[]): string {
  const counts = new Map<string, number>();
  for (const { repo } of items) {
    const name = repo.folder || repo.name;
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  if (counts.size < 2) return "";
  return [...counts].map(([name, n]) => `\n${name}: ${n}`).join("");
}

/** GitHub's own marks: the pull request glyph for PRs, the circled dot for issues */
export function GitHubCounts({
  prs,
  issues,
}: {
  prs: Pick<GitHubOverview["prs"][number], "ci" | "repo">[];
  issues: Pick<GitHubOverview["issues"][number], "repo">[];
}) {
  const failing = prs.filter((pr) => pr.ci === "failing").length;
  return (
    <>
      {prs.length > 0 && (
        <Count
          title={`${plural(prs.length, "PR")}${failing > 0 ? `, ${failing} with CI failing` : ""}${perRepo(prs)}`}
          tone={failing > 0 ? "text-error" : "text-text-muted"}
        >
          <GitPullRequest className="h-2.5 w-2.5" aria-hidden="true" />
          {prs.length}
        </Count>
      )}
      {issues.length > 0 && (
        <Count title={`${plural(issues.length, "issue")}${perRepo(issues)}`} tone="text-text-muted">
          <CircleDot className="h-2.5 w-2.5" aria-hidden="true" />
          {issues.length}
        </Count>
      )}
    </>
  );
}
