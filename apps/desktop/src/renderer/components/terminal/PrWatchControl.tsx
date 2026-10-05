import { cn } from "@exegol/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { GitPullRequest } from "lucide-react";
import { trpcInvoke, trpcMutate } from "../../lib/trpc-client";
import { useAgentStore } from "../../stores/agents";
import type { QuietAgent } from "../common/QuietControls";

interface PrWatchStatus {
  pr: { number: number; url: string; failingChecks: number; conflicting: boolean } | null;
  lastPolledAt: number | null;
}

function describe(status: PrWatchStatus | undefined): { label: string; title: string } {
  const pr = status?.pr;
  if (!pr) {
    return {
      label: "PR watch",
      title: status?.lastPolledAt
        ? "Watching, but this branch has no open PR. Click to stop"
        : "Watching: the first check runs within a minute. Click to stop",
    };
  }
  const problems = [
    pr.failingChecks > 0 && `${pr.failingChecks} failing check${pr.failingChecks === 1 ? "" : "s"}`,
    pr.conflicting && "merge conflicts",
  ].filter(Boolean);
  return {
    label: `PR #${pr.number}`,
    title:
      `Watching ${pr.url}${problems.length ? `: ${problems.join(", ")}` : ""}. ` +
      "Checks, reviews and conflicts reach the agent at its next turn. Click to stop",
  };
}

/** Opt-in: tell the agent about its PR's failing checks, new reviews and conflicts */
export function PrWatchControl({ agent }: { agent: QuietAgent }) {
  const on = !!agent.prWatch;
  const queryClient = useQueryClient();
  const { data: status } = useQuery({
    queryKey: ["agents", "prWatchStatus", agent.id],
    queryFn: () => trpcInvoke<PrWatchStatus>("agents.prWatchStatus", { id: agent.id }),
    enabled: on,
    refetchInterval: 60_000,
  });
  const toggle = () => {
    useAgentStore.getState().updateAgent(agent.id, { prWatch: !on });
    trpcMutate("agents.setPrWatch", { id: agent.id, on: !on })
      .then(() =>
        queryClient.invalidateQueries({ queryKey: ["agents", "prWatchStatus", agent.id] }),
      )
      .catch((err) => {
        useAgentStore.getState().updateAgent(agent.id, { prWatch: on });
        console.error("[PrWatch] toggle failed:", err);
      });
  };
  const { label, title } = on
    ? describe(status)
    : {
        label: "Watch PR",
        title:
          "Watch this branch's PR: failing checks, review comments and merge conflicts are sent to the agent at its next turn",
      };
  const alert = on && !!status?.pr && (status.pr.failingChecks > 0 || status.pr.conflicting);
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        toggle();
      }}
      className={cn(
        "flex shrink-0 items-center gap-0.5 rounded px-1 py-0 text-[9px] hover:bg-white/10",
        alert ? "text-error" : on ? "text-accent" : "text-text-muted hover:text-text-primary",
      )}
      title={title}
    >
      <GitPullRequest className="h-3 w-3" />
      {label}
    </button>
  );
}
