import type { SimDevice, SimulatorSupport } from "@exegol/shared";
import { useQuery } from "@tanstack/react-query";
import { IS_MAC } from "../lib/keymap";
import { trpcInvoke } from "../lib/trpc-client";

/** Xcode's simctl (and AXe) on this Mac; never asked elsewhere */
export function useSimulatorSupport() {
  return useQuery({
    queryKey: ["simulator", "support"],
    queryFn: () => trpcInvoke<SimulatorSupport>("simulator.support"),
    enabled: IS_MAC,
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
    // Fast while waiting for a boot, slow once one runs
    refetchInterval: (q) => (q.state.data?.some((d) => d.state === "Booted") ? 30_000 : 5_000),
  });
}
