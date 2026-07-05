import { useQuery } from "@tanstack/react-query";
import { trpcInvoke } from "../../lib/trpc-client";

export type DoctorStatus = "ok" | "warn" | "fail";

export interface DoctorCheck {
  id: string;
  label: string;
  status: DoctorStatus;
  detail: string;
  actionUrl?: string;
}

export interface DoctorReport {
  checks: DoctorCheck[];
  generatedAt: number;
}

export function useDoctorReport() {
  return useQuery({
    queryKey: ["doctor", "run"],
    queryFn: () => trpcInvoke<DoctorReport>("doctor.run"),
    staleTime: 10_000,
  });
}
