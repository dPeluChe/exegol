import { acceptsFollowUps, type FollowUpItem, STEER_TIMEOUT_MS } from "@exegol/shared";
import { cn } from "@exegol/ui";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ListPlus, X, Zap } from "lucide-react";
import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useFittedMenu } from "../../hooks/use-fitted-menu";
import { useEnabledProviders } from "../../hooks/use-providers";
import { trpcInvoke, trpcMutate } from "../../lib/trpc-client";
import { followUpsKey, useAgentStore } from "../../stores/agents";
import { toastError, useToastStore } from "../../stores/toasts";

const STEER_SECONDS = STEER_TIMEOUT_MS / 1000;

/** The queue lives in main; its push event (startAgentStatusPush) keeps the cache current */
function useFollowUps(agentId: string, enabled: boolean): FollowUpItem[] {
  const { data = [] } = useQuery({
    queryKey: followUpsKey(agentId),
    queryFn: () => trpcInvoke<FollowUpItem[]>("agents.followUps", { id: agentId }),
    enabled,
    staleTime: Number.POSITIVE_INFINITY,
  });
  return data;
}

/** Follow-up queue + Steer for a live agent (terminal toolbar, Watching card): queued prompts are
 *  typed at its next turn boundary; Steer interrupts the turn and types now */
export function FollowUpControl({ agentId, className }: { agentId: string; className?: string }) {
  const agent = useAgentStore((s) => s.agents[agentId]);
  const eligible = !!agent && acceptsFollowUps(agent);
  const canSteer = !!useEnabledProviders().find((p) => p.id === agent?.cliType)?.interruptKey;
  const items = useFollowUps(agentId, eligible);
  const [anchor, setAnchor] = useState<{ x: number; y: number } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuStyle = useFittedMenu(menuRef, anchor);
  if (!eligible) return null;

  return (
    <>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          const rect = e.currentTarget.getBoundingClientRect();
          setAnchor(anchor ? null : { x: rect.left, y: rect.bottom + 4 });
        }}
        className={cn(
          "flex shrink-0 items-center gap-0.5 rounded px-1 py-0 text-[9px] hover:bg-white/10",
          items.length > 0 ? "text-accent" : "text-text-muted hover:text-text-primary",
          className,
        )}
        title={
          items.length > 0
            ? `${items.length} follow-up${items.length === 1 ? "" : "s"} queued for the next turn`
            : "Queue a follow-up for the next turn, or steer the agent now"
        }
      >
        <ListPlus className="h-3 w-3" />
        {items.length > 0 ? items.length : "Queue"}
      </button>
      {anchor &&
        createPortal(
          <>
            <div
              className="fixed inset-0 z-[100]"
              onClick={() => setAnchor(null)}
              onKeyDown={() => {}}
              role="none"
            />
            <div
              ref={menuRef}
              className="fixed z-[101] w-80 rounded-lg border border-border bg-bg-secondary p-2 shadow-2xl"
              style={menuStyle}
            >
              <FollowUpPanel
                agentId={agentId}
                items={items}
                canSteer={canSteer}
                onClose={() => setAnchor(null)}
              />
            </div>
          </>,
          document.body,
        )}
    </>
  );
}

function FollowUpPanel({
  agentId,
  items,
  canSteer,
  onClose,
}: {
  agentId: string;
  items: FollowUpItem[];
  canSteer: boolean;
  onClose: () => void;
}) {
  const [text, setText] = useState("");
  const queue = useMutation({
    mutationFn: (t: string) =>
      trpcMutate<{ delivered: boolean }>("agents.queueFollowUp", { id: agentId, text: t }),
    onSuccess: () => setText(""),
    onError: toastError("Not queued"),
  });
  const steer = useMutation({
    mutationFn: (t: string) =>
      trpcMutate<{ delivered: boolean }>("agents.steer", { id: agentId, text: t }),
    onMutate: () => setText(""),
    onSuccess: (res) => {
      if (res.delivered) return;
      useToastStore.getState().addToast({
        type: "warning",
        title: "Steer: still queued",
        body: `The agent did not reach its prompt within ${STEER_SECONDS}s. The message goes at its next turn.`,
        agentId,
      });
    },
    onError: toastError("Steer failed"),
  });
  const remove = useMutation({
    mutationFn: (itemId: string) => trpcMutate("agents.removeFollowUp", { id: agentId, itemId }),
    onError: toastError("Not removed"),
  });
  const busy = queue.isPending || steer.isPending;
  const trimmed = text.trim();
  const btn = "rounded px-2 py-0.5 text-[11px] disabled:opacity-50";

  return (
    <div className="space-y-2 text-[11px]">
      <div className="text-[9px] font-semibold uppercase tracking-wider text-text-muted">
        Follow-ups
      </div>
      {items.length > 0 ? (
        <ol className="max-h-48 space-y-1 overflow-y-auto">
          {items.map((item, i) => (
            <li key={item.id} className="flex items-start gap-1 rounded bg-white/5 px-1.5 py-1">
              <span className="shrink-0 text-text-muted tabular-nums">{i + 1}.</span>
              <span className="min-w-0 flex-1 whitespace-pre-wrap break-words text-text-primary">
                {item.text}
              </span>
              <button
                type="button"
                onClick={() => remove.mutate(item.id)}
                className="shrink-0 rounded p-0.5 text-text-muted hover:bg-white/10 hover:text-text-primary"
                title="Remove"
              >
                <X className="h-3 w-3" />
              </button>
            </li>
          ))}
        </ol>
      ) : (
        <p className="text-text-muted">
          Nothing queued. A follow-up is typed when the agent ends its turn.
        </p>
      )}
      <textarea
        // biome-ignore lint/a11y/noAutofocus: the popover opens to type a message
        autoFocus
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") onClose();
          if (e.key === "Enter" && !e.shiftKey && trimmed && !busy) {
            e.preventDefault();
            queue.mutate(trimmed);
          }
        }}
        rows={3}
        placeholder="Message for the agent (Enter: send later, Shift+Enter: new line)"
        className="w-full resize-none rounded border border-border bg-bg-primary px-2 py-1 text-[11px] text-text-primary outline-none focus:border-accent"
      />
      <div className="flex items-center justify-end gap-1">
        {steer.isPending && <span className="mr-auto text-text-muted">Steering...</span>}
        <button
          type="button"
          disabled={!trimmed || busy}
          onClick={() => queue.mutate(trimmed)}
          className={cn(btn, "border border-border text-text-secondary hover:bg-white/5")}
          title="Typed when the agent ends its current turn (now, if it is at its prompt)"
        >
          Send later
        </button>
        {canSteer && (
          <button
            type="button"
            disabled={!trimmed || busy}
            onClick={() => steer.mutate(trimmed)}
            className={cn(
              btn,
              "flex items-center gap-1 border border-accent/50 bg-accent/15 text-text-primary hover:bg-accent/25",
            )}
            title={`Interrupt the turn, wait for the prompt (up to ${STEER_SECONDS}s), then type this`}
          >
            <Zap className="h-3 w-3" />
            Steer
          </button>
        )}
      </div>
    </div>
  );
}
