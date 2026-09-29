import { useMemo } from "react";
import { type PortInfo, usePreferredPort, useProjectPorts } from "../../hooks/use-trpc-scheduler";

/** Deduplicate ports, prefer runtime over config */
function dedupePorts(ports: PortInfo[] | undefined): PortInfo[] {
  if (!ports) return [];
  const map = new Map<number, PortInfo>();
  for (const p of ports) {
    const existing = map.get(p.port);
    if (!existing || (p.source === "runtime" && existing.source === "config")) {
      map.set(p.port, p);
    }
  }
  return Array.from(map.values());
}

/** The project's dev-server ports and the one a new browser pane should open */
export function useDevServerPorts(projectPath: string | null, projectId: string | null) {
  const { data: ports } = useProjectPorts(projectPath);
  const { data: preferredPort } = usePreferredPort(projectId);
  const uniquePorts = useMemo(() => dedupePorts(ports), [ports]);
  const autoPort =
    preferredPort ?? uniquePorts.find((p) => p.source === "runtime")?.port ?? uniquePorts[0]?.port;
  return { uniquePorts, preferredPort, autoPort };
}
