import type { ScreenDialog } from "@exegol/shared";
import { cn } from "@exegol/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { trpcInvoke, trpcMutate } from "../../lib/trpc-client";
import { useAgentStore } from "../../stores/agents";
import { toastError } from "../../stores/toasts";

/** The question an agent waits on, read from its screen, answered without opening the pane */
export function AgentQuestion({ agentId, enabled }: { agentId: string; enabled: boolean }) {
  const queryClient = useQueryClient();
  const queryKey = ["screenDialog", agentId];
  const { data: dialog } = useQuery({
    queryKey,
    queryFn: () => trpcInvoke<ScreenDialog | null>("agents.screenDialog", { id: agentId }),
    enabled,
    refetchInterval: 2_000,
  });
  const answer = useMutation({
    mutationFn: (key: string) =>
      trpcMutate("agents.answerDialog", {
        id: agentId,
        key,
        fingerprint: dialog?.fingerprint ?? "",
      }),
    onSuccess: () => useAgentStore.getState().markAttentionRead(agentId),
    onError: toastError("Not sent"),
    onSettled: () => queryClient.invalidateQueries({ queryKey }),
  });
  if (!enabled || !dialog) return null;

  return (
    <div className="space-y-1.5 rounded-md border border-amber-500/30 bg-amber-500/5 p-2 text-[11px]">
      {dialog.context.slice(-2).map((line, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: two fixed context rows
        <p key={i} className="truncate font-mono text-[10px] text-text-muted" title={line}>
          {line}
        </p>
      ))}
      {dialog.question && <p className="text-text-primary">{dialog.question}</p>}
      <div className="flex flex-col items-start gap-1">
        {dialog.options.map((o) => (
          // The whole label: a "Yes, and always allow…" must show what it widens
          <button
            key={o.key}
            type="button"
            disabled={answer.isPending}
            onClick={(e) => {
              e.stopPropagation();
              answer.mutate(o.key);
            }}
            className={cn(
              "rounded border px-2 py-0.5 text-left disabled:opacity-50",
              o.key === "1"
                ? "border-accent/50 bg-accent/15 text-text-primary hover:bg-accent/25"
                : "border-border text-text-secondary hover:bg-white/5",
            )}
          >
            {o.key}. {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}
