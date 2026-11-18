import { useShallow } from "zustand/react/shallow";
import { groupTargets } from "../components/terminal/send-targets";
import { useCliSessionNames } from "../components/terminal/use-send-to";
import { isLiveSession } from "../lib/sidebar-views";
import { useAgentStore } from "../stores/agents";

/** A project's open sessions that have a name, with each one's name inside its CLI */
export function useSessionTargets(projectId: string | null) {
  const sessions = useAgentStore(
    useShallow((s) =>
      projectId
        ? Object.values(s.agents).filter(
            (a) => a.projectId === projectId && isLiveSession(a) && !a.archived && !!a.alias,
          )
        : [],
    ),
  );
  const groups = groupTargets(sessions, new Map());
  return { targets: groups.flatMap((g) => g.targets), cliNames: useCliSessionNames(groups) };
}
