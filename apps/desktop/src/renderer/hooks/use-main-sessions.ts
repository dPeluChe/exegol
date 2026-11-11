import type { MainSession } from "@exegol/shared";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { isLiveSession } from "../lib/sidebar-views";
import { trpcInvoke, trpcMutate } from "../lib/trpc-client";
import { useAgentStore } from "../stores/agents";

type MainSessions = Record<string, MainSession>;

export const MAIN_SESSIONS_KEY = ["agents", "mainSessions"];

/** Each project's main session. Read again when the set of live sessions changes (the default
 *  rule depends on it) and on `projects:changed` (a mark set, cleared or moved by a resume: `useProjectsSync`) */
export function useMainSessions() {
  const live = useAgentStore((s) =>
    Object.values(s.agents)
      .filter(isLiveSession)
      .map((a) => a.id)
      .sort()
      .join(","),
  );
  return useQuery({
    queryKey: [...MAIN_SESSIONS_KEY, live],
    queryFn: () => trpcInvoke<MainSessions>("agents.mainSessions"),
    placeholderData: (previous) => previous,
  }).data;
}

/** The main session of a project with company: with one session the badge says nothing */
export const mainAmongSeveral = (mains: MainSessions | undefined, projectId: string) => {
  const main = mains?.[projectId];
  return main && main.live > 1 ? main.id : undefined;
};

export function useSetMainSession() {
  const queryClient = useQueryClient();
  return (agentId: string, main: boolean) =>
    trpcMutate<void>("agents.setMain", { id: agentId, main })
      .then(() => queryClient.invalidateQueries({ queryKey: MAIN_SESSIONS_KEY }))
      .catch((err) => console.error("[MainSession] change failed:", err));
}
