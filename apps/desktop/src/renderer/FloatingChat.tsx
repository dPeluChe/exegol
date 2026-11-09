import { useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
import { LoadingSpinner } from "./components/common";
import { ErrorBoundary, paneFallback } from "./components/ErrorBoundary";
import { CommanderVoiceOptions } from "./components/workspace/sections/CommanderVoiceOptions";
import { CompanyChat } from "./components/workspace/sections/CompanyChat";
import { commanderToast } from "./hooks/use-commander-alerts";
import { useMountEffect } from "./hooks/use-mount-effect";
import { useAgent } from "./hooks/use-trpc";
import { isOpenSession } from "./lib/sidebar-views";
import { followUpsKey, toAgentState, useAgentStore } from "./stores/agents";
import { noteDeskActivity } from "./stores/desk-activity";

const ATTENTION_STORAGE = "exegol-agent-attention";

// No agents store feed here: its writes would persist stale attention over the main window's.
// The session is read again on each status push; attention is re-read from what the main saves
function useFloatingSession(agentId: string) {
  const queryClient = useQueryClient();
  useMountEffect(() => {
    const offStatus = window.api.onAgentStatus((event) => {
      if (event.agentId !== agentId) return;
      void queryClient.invalidateQueries({ queryKey: ["agent", agentId] });
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
  const { data, isPending } = useAgent(agentId);
  const agent = useMemo(() => (data ? toAgentState(data) : null), [data]);
  return { agent, isPending };
}

/** A session's chat in its own always-on-top window */
export function FloatingChat({
  agentId,
  title,
  speak = false,
}: {
  agentId: string;
  title: string;
  speak?: boolean;
}) {
  const { agent, isPending } = useFloatingSession(agentId);
  // The main window plays the chime; here only its line, where the person is looking
  useMountEffect(() =>
    speak ? window.api.onCommanderAlert(({ message }) => commanderToast(message)) : undefined,
  );
  if (isPending) return <LoadingSpinner label="Loading chat..." className="h-full" />;
  return (
    <div className="flex h-full min-h-0 flex-col">
      {agent && isOpenSession(agent) ? (
        <ErrorBoundary fallback={paneFallback}>
          {speak && (
            <div className="flex shrink-0 justify-end border-b border-border px-2 py-1">
              <CommanderVoiceOptions compact />
            </div>
          )}
          <div className="min-h-0 flex-1">
            <CompanyChat agent={agent} where="Every project" dictation={false} speak={speak} />
          </div>
        </ErrorBoundary>
      ) : (
        <div className="flex h-full items-center justify-center p-4">
          <p className="text-center text-xs text-text-muted">The {title} is not running.</p>
        </div>
      )}
    </div>
  );
}
