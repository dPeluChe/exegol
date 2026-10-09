import { SIDECAR_HEALTHY, type SidecarHealth } from "@exegol/shared";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { trpcInvoke } from "../lib/trpc-client";
import { useMountEffect } from "./use-mount-effect";

const KEY = ["sidecar", "health"];

/** Seeded from main (a window opened mid-stall), then followed on `sidecar:health` */
export function useSidecarHealth(): SidecarHealth {
  const queryClient = useQueryClient();
  useMountEffect(() =>
    window.api?.onSidecarHealth?.((next) => queryClient.setQueryData(KEY, next)),
  );
  const { data } = useQuery({
    queryKey: KEY,
    queryFn: () => trpcInvoke<SidecarHealth>("sidecar.health"),
    staleTime: Number.POSITIVE_INFINITY,
  });
  return data ?? SIDECAR_HEALTHY;
}
