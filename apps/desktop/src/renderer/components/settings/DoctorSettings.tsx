import { DoctorChecklist } from "../onboarding/DoctorChecklist";
import { useDoctorReport } from "../onboarding/use-doctor";

export function DoctorSettings() {
  const { data, isLoading, isFetching, refetch } = useDoctorReport();

  return (
    <div className="space-y-4 rounded-lg border border-border bg-bg-secondary p-4">
      <p className="text-xs text-text-muted">
        Health check of the CLIs, tools, and services Exegol relies on.
      </p>
      <DoctorChecklist
        checks={data?.checks ?? []}
        isLoading={isLoading}
        onRefresh={() => refetch()}
        isRefreshing={isFetching}
      />
    </div>
  );
}
