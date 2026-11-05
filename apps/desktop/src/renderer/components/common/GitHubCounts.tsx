import type { GitHubOverview } from "@exegol/shared";
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

/** GitHub's own marks: the pull request glyph for PRs, the circled dot for issues */
export function GitHubCounts({
  prs,
  issues,
}: {
  prs: Pick<GitHubOverview["prs"][number], "ci">[];
  issues: unknown[];
}) {
  const failing = prs.filter((pr) => pr.ci === "failing").length;
  return (
    <>
      {prs.length > 0 && (
        <Count
          title={`${plural(prs.length, "PR")}${failing > 0 ? `, ${failing} with CI failing` : ""}`}
          tone={failing > 0 ? "text-error" : "text-text-muted"}
        >
          <GitPullRequest className="h-2.5 w-2.5" aria-hidden="true" />
          {prs.length}
        </Count>
      )}
      {issues.length > 0 && (
        <Count title={plural(issues.length, "issue")} tone="text-text-muted">
          <CircleDot className="h-2.5 w-2.5" aria-hidden="true" />
          {issues.length}
        </Count>
      )}
    </>
  );
}
