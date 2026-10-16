import { dedupeDevPorts, pickDevServerPort, splitDevPorts } from "@exegol/shared";
import { useMemo } from "react";
import { usePreferredPort, useProjectPorts } from "../../hooks/use-trpc-scheduler";

/** The project's dev-server pages, its helper ports, and the one a new browser pane should open */
export function useDevServerPorts(projectPath: string | null, projectId: string | null) {
  const { data: ports } = useProjectPorts(projectPath);
  const { data: preferredPort } = usePreferredPort(projectId);
  const { pages, helpers } = useMemo(() => splitDevPorts(dedupeDevPorts(ports)), [ports]);
  const autoPort = pickDevServerPort(pages, preferredPort);
  return { pagePorts: pages, helperPorts: helpers, preferredPort, autoPort };
}
