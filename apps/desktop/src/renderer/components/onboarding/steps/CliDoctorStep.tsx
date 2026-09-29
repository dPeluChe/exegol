import { Button } from "@exegol/ui";
import { DoctorChecklist } from "../DoctorChecklist";
import { useDoctorReport } from "../use-doctor";

interface CliDoctorStepProps {
  onNext: () => void;
  onBack: () => void;
}

export function CliDoctorStep({ onNext, onBack }: CliDoctorStepProps) {
  const { data, isLoading, isFetching, refetch } = useDoctorReport();

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <div>
        <h2 className="text-base font-semibold text-text-primary">Checking your setup</h2>
        <p className="text-xs text-text-muted">
          We looked for the CLIs you have installed and a few tools Exegol relies on.
        </p>
      </div>

      {/* The list scrolls; Back / Continue stay in view (they fell off the window) */}
      <div className="min-h-0 flex-1 overflow-y-auto pr-1">
        <DoctorChecklist
          checks={data?.checks ?? []}
          isLoading={isLoading}
          onRefresh={() => refetch()}
          isRefreshing={isFetching}
          foldMissingClis
        />
      </div>

      <div className="flex shrink-0 justify-between pt-2">
        <Button type="button" variant="ghost" onClick={onBack} className="text-text-secondary">
          Back
        </Button>
        <Button type="button" onClick={onNext} className="bg-accent text-white">
          Continue
        </Button>
      </div>
    </div>
  );
}
