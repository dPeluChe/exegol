import type { DoctorReport } from "@exegol/shared";
import { useQuery } from "@tanstack/react-query";
import { trpcInvoke } from "../../lib/trpc-client";

export type { DoctorCategory, DoctorCheck, DoctorReport, DoctorStatus } from "@exegol/shared";

export function useDoctorReport() {
  return useQuery({
    queryKey: ["doctor", "run"],
    queryFn: () => trpcInvoke<DoctorReport>("doctor.run"),
    staleTime: 10_000,
    // Each run spawns the CLIs' --version: not on every window focus
    refetchOnWindowFocus: false,
  });
}
