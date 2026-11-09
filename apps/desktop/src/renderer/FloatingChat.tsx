import type { Agent } from "@exegol/shared";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
import { LoadingSpinner } from "./components/common";
import { ToastStack } from "./components/common/ToastStack";
import { ErrorBoundary, paneFallback } from "./components/ErrorBoundary";
import { CompanyChat } from "./components/workspace/sections/CompanyChat";
import { useMountEffect } from "./hooks/use-mount-effect";
import { floatingChatKey, withStatusPush } from "./lib/floating-chat";
import { isOpenSession } from "./lib/sidebar-views";
import { trpcInvoke } from "./lib/trpc-client";
import { followUpsKey, toAgentState, useAgentStore } from "./stores/agents";
import { noteDeskActivity } from "./stores/desk-activity";

const ATTENTION_STORAGE = "exegol-agent-attention";
const FALLBACK_POLL_MS = 30_000;

// No agents store feed here: its writes would persist stale attention over the main window's.
// The session is a query moved by pushes; attention is re-read from what the main window saves
function useFloatingSession(agentId: string) {
  const queryClient = useQueryClient();
  const queryKey = floatingChatKey(agentId);
  useMountEffect(() => {
    const offStatus = window.api.onAgentStatus((event) => {
      if (event.agentId !== agentId) return;
      queryClient.setQueryData<Agent | null>(
        queryKey,
        (held) => held && withStatusPush(held, event),
      );
    });
    const offActivity = window.api.onAgentActivity((event) => {
      if (event.agentId === agentId) noteDeskActivity(agentId, event.activity);
    });
    const offFollowUps = window.api.onFollowUps((event) => {
      if (event.agentId === agentId) queryClient.setQueryData(followUpsKey(agentId), event.items);
    });
    const onStorage = (event: StorageEvent) => {
      if (event.key === ATTENTION_STORAGE) void useAgentStore.persist.rehydrate();
    };
    window.addEventListener("storage", onStorage);
    return () => {
      offStatus();
      offActivity();
      offFollowUps();
      window.removeEventListener("storage", onStorage);
    };
  });
  const { data, isPending } = useQuery({
    queryKey,
    queryFn: () => trpcInvoke<Agent | null>("agents.get", { id: agentId }),
    refetchInterval: FALLBACK_POLL_MS,
  });
  const agent = useMemo(() => (data ? toAgentState(data) : null), [data]);
  return { agent, isPending };
}

/** A session's chat in its own always-on-top window */
export function FloatingChat({ agentId, title }: { agentId: string; title: string }) {
  const { agent, isPending } = useFloatingSession(agentId);
  if (isPending) return <LoadingSpinner label="Loading chat..." className="h-full" />;
  return (
    <div className="flex h-full min-h-0 flex-col">
      {agent && isOpenSession(agent) ? (
        <ErrorBoundary fallback={paneFallback}>
          <CompanyChat agent={agent} where="Every project" dictation={false} />
        </ErrorBoundary>
      ) : (
        <div className="flex h-full items-center justify-center p-4">
          <p className="text-center text-xs text-text-muted">The {title} is not running.</p>
        </div>
      )}
      {/* Send and load errors (toastError) need a host in this window */}
      <ToastStack />
    </div>
  );
}
