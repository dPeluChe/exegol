import { Button } from "@exegol/ui";
import { DoctorChecklist } from "../DoctorChecklist";
import { type DoctorCategory, useDoctorReport } from "../use-doctor";

interface CliDoctorStepProps {
  onNext: () => void;
  onBack: () => void;
  title: string;
  description: string;
  categories: DoctorCategory[];
}

/** One slice of the Doctor per step: agent CLIs, then system and configuration */
export function CliDoctorStep({
  onNext,
  onBack,
  title,
  description,
  categories,
}: CliDoctorStepProps) {
  const { data, isLoading, isFetching, refetch } = useDoctorReport();

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <div>
        <h2 className="text-base font-semibold text-text-primary">{title}</h2>
        <p className="text-xs text-text-muted">{description}</p>
      </div>

      {/* The list scrolls; Back / Continue stay in view (they fell off the window) */}
      <div className="min-h-0 flex-1 overflow-y-auto pr-1">
        <DoctorChecklist
          checks={data?.checks ?? []}
          isLoading={isLoading}
          onRefresh={() => refetch()}
          isRefreshing={isFetching}
          foldMissingClis
          categories={categories}
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
