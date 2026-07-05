import { useEffect, useState } from "react";
import { useProjects } from "../../hooks/use-trpc";
import { useAppStore } from "../../stores/app";
import { ApiKeysStep } from "./steps/ApiKeysStep";
import { CliDoctorStep } from "./steps/CliDoctorStep";
import { DoneStep } from "./steps/DoneStep";
import { FirstProjectStep } from "./steps/FirstProjectStep";
import { WelcomeStep } from "./steps/WelcomeStep";

const STEP_COUNT = 5;
const STEP_DOT_IDS = ["welcome", "doctor", "api-keys", "first-project", "done"] as const;

export function OnboardingWizard() {
  const onboardingComplete = useAppStore((s) => s.onboardingComplete);
  const setOnboardingComplete = useAppStore((s) => s.setOnboardingComplete);
  const { data: projects, isLoading: projectsLoading } = useProjects();
  const [step, setStep] = useState(0);

  const hasExistingProjects = (projects?.length ?? 0) > 0;

  // Upgrading users who already have projects never saw this wizard and
  // shouldn't be interrupted by it — silently mark onboarding as done.
  useEffect(() => {
    if (!projectsLoading && hasExistingProjects && !onboardingComplete) {
      setOnboardingComplete(true);
    }
  }, [projectsLoading, hasExistingProjects, onboardingComplete, setOnboardingComplete]);

  if (onboardingComplete || projectsLoading || hasExistingProjects) return null;

  const next = () => setStep((s) => Math.min(s + 1, STEP_COUNT - 1));
  const back = () => setStep((s) => Math.max(s - 1, 0));
  const finish = () => setOnboardingComplete(true);

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70">
      <div className="w-full max-w-lg rounded-lg border border-border bg-bg-secondary p-6 shadow-2xl">
        <div className="mb-5 flex items-center justify-center gap-1.5">
          {STEP_DOT_IDS.map((id, i) => (
            <div
              key={id}
              className={`h-1 w-8 rounded-full transition-colors ${
                i <= step ? "bg-accent" : "bg-white/10"
              }`}
            />
          ))}
        </div>

        {step === 0 && <WelcomeStep onNext={next} />}
        {step === 1 && <CliDoctorStep onNext={next} onBack={back} />}
        {step === 2 && <ApiKeysStep onNext={next} onBack={back} />}
        {step === 3 && <FirstProjectStep onNext={next} onBack={back} onSkip={next} />}
        {step === 4 && <DoneStep onFinish={finish} />}

        {step > 0 && step < STEP_COUNT - 1 && (
          <div className="mt-4 text-center">
            <button
              type="button"
              onClick={finish}
              className="text-[11px] text-text-muted hover:text-text-secondary"
            >
              Skip setup
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
