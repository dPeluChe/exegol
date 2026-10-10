import type { SimDevice, SimulatorSupport } from "@exegol/shared";
import { useQuery } from "@tanstack/react-query";
import { trpcInvoke } from "../lib/trpc-client";

const isMac = () => (window.api?.app?.getPlatform?.() ?? "darwin") === "darwin";

/** Xcode's simctl (and AXe) on this Mac; never asked elsewhere */
export function useSimulatorSupport() {
  return useQuery({
    queryKey: ["simulator", "support"],
    queryFn: () => trpcInvoke<SimulatorSupport>("simulator.support"),
    enabled: isMac(),
    staleTime: 60_000,
  });
}

/** Whether to offer a Simulator pane at all (launcher chip, menu, palette) */
export function useSimulatorAvailable(): boolean {
  return useSimulatorSupport().data?.simctl === true;
}

export function useSimDevices(enabled: boolean) {
  return useQuery({
    queryKey: ["simulator", "devices"],
    queryFn: () => trpcInvoke<SimDevice[]>("simulator.devices"),
    enabled,
    refetchInterval: 5_000,
  });
}
