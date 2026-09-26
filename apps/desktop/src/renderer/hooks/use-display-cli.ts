import { useQuery } from "@tanstack/react-query";
import { trpcInvoke } from "../lib/trpc-client";

/** An agent CLI started by hand in a plain terminal: one shared poll, only while a shell is shown */
export function useDisplayCli(agent: { id: string; cliType: string }): string {
  const isShell = agent.cliType === "shell";
  const { data } = useQuery({
    queryKey: ["agents", "shellClis"],
    queryFn: () => trpcInvoke<Record<string, string>>("agents.detectShellClis"),
    enabled: isShell,
    refetchInterval: 5_000,
    staleTime: 4_000,
  });
  return (isShell && data?.[agent.id]) || agent.cliType;
}
