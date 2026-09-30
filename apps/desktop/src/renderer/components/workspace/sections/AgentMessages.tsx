import type { AgentMessage, MessageDeliveryState } from "@exegol/shared";
import { cn } from "@exegol/ui";
import { useQuery } from "@tanstack/react-query";
import { ArrowDownLeft, ArrowUpRight } from "lucide-react";
import { formatTimeAgo } from "../../../lib/format";
import { trpcInvoke } from "../../../lib/trpc-client";
import { useAgentStore } from "../../../stores/agents";

const DELIVERY: Record<MessageDeliveryState, { label: string; tone: string }> = {
  queued: { label: "queued", tone: "text-amber-400" },
  delivered: { label: "delivered", tone: "text-sky-400" },
  consumed: { label: "read", tone: "text-green-400" },
  cancelled: { label: "cancelled", tone: "text-text-muted" },
  undeliverable: { label: "undeliverable", tone: "text-red-400" },
};

/** Messages this agent sent or received through the Exegol MCP server, newest last */
export function useAgentMessages(agentId: string) {
  return useQuery({
    queryKey: ["messages", "agent", agentId],
    queryFn: () => trpcInvoke<AgentMessage[]>("messages.list", { agentId, limit: 50 }),
    select: (rows) => [...rows].reverse(),
    refetchInterval: 10_000,
  });
}

/** The thread between this agent and the others: who said what, and whether it arrived */
export function AgentMessagesPanel({
  agentId,
  messages,
}: {
  agentId: string;
  messages: AgentMessage[];
}) {
  const agents = useAgentStore((s) => s.agents);
  const nameOf = (id: string | null) =>
    id ? (agents[id]?.alias ?? agents[id]?.cliType ?? id.slice(0, 8)) : "Exegol";

  return (
    <ul className="relative mt-2 max-h-64 space-y-1.5 overflow-y-auto border-t border-border pt-2">
      {messages.map((m) => {
        const outgoing = m.fromAgentId === agentId;
        const Arrow = outgoing ? ArrowUpRight : ArrowDownLeft;
        const delivery = m.deliveryState ? DELIVERY[m.deliveryState] : null;
        return (
          <li key={m.id} className="rounded-md bg-black/20 px-2 py-1.5 text-[11px]">
            <div className="mb-0.5 flex items-center gap-1.5 text-[10px] text-text-muted">
              <Arrow className={cn("h-3 w-3", outgoing ? "text-accent" : "text-sky-400")} />
              <span className="font-medium text-text-secondary">
                {outgoing ? `to ${nameOf(m.toAgentId)}` : `from ${nameOf(m.fromAgentId)}`}
              </span>
              {m.type !== "text" && <span className="rounded bg-white/5 px-1">{m.type}</span>}
              <span>{formatTimeAgo(m.createdAt)}</span>
              {delivery && <span className={cn("ml-auto", delivery.tone)}>{delivery.label}</span>}
            </div>
            <p className="whitespace-pre-wrap break-words text-text-secondary">{m.content}</p>
          </li>
        );
      })}
    </ul>
  );
}
