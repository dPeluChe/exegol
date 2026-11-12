import { useMemo } from "react";
import { useShallow } from "zustand/react/shallow";
import { type NameLink, projectHref, sessionHref } from "../lib/name-links";
import { isLiveSession } from "../lib/sidebar-views";
import { useAgentStore } from "../stores/agents";
import { useProjects } from "./use-trpc";

const NONE: NameLink[] = [];
const NONE_KEYS: string[] = [];

/** Live sessions and projects by name, for a chat that names them (the Commander's). Sessions
 *  first: a session named like its project opens the session */
// A PiP window has no workspace to jump in
const FLOATING = new URLSearchParams(window.location.search).has("floatingPane");

export function useNameLinks(wanted: boolean, ownProjectId: string): NameLink[] {
  const enabled = wanted && !FLOATING;
  const { data: projects } = useProjects();
  const sessions = useAgentStore(
    useShallow((s) =>
      enabled
        ? Object.values(s.agents)
            // Only a given name: an unnamed session is called by its CLI, a word any reply uses
            .filter((a) => a.alias && isLiveSession(a) && a.projectId !== ownProjectId)
            .map((a) => `${sessionHref(a.id, a.projectId)}\n${a.alias}`)
        : NONE_KEYS,
    ),
  );
  return useMemo(() => {
    if (!enabled) return NONE;
    return [
      ...sessions.map((key): NameLink => {
        const [href = "", name = ""] = key.split("\n");
        return { name, href };
      }),
      ...(projects ?? [])
        .filter((p) => p.id !== ownProjectId)
        .map((p): NameLink => ({ name: p.name, href: projectHref(p.id) })),
    ];
  }, [enabled, sessions, projects, ownProjectId]);
}
