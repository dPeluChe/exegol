import { useEffect, useState } from "react";
import { useProjects } from "../../hooks/use-trpc";
import { useAppStore } from "../../stores/app";
import { ApiKeysStep } from "./steps/ApiKeysStep";
import { CliDoctorStep } from "./steps/CliDoctorStep";
import { DoneStep } from "./steps/DoneStep";
import { FirstProjectStep } from "./steps/FirstProjectStep";
import { WelcomeStep } from "./steps/WelcomeStep";

const STEPS = [
  { id: "welcome", label: "Welcome" },
  { id: "clis", label: "Your agent CLIs" },
  { id: "system", label: "System & services" },
  { id: "api-keys", label: "API keys" },
  { id: "first-project", label: "First project" },
  { id: "done", label: "Done" },
] as const;
const STEP_COUNT = STEPS.length;

export function OnboardingWizard() {
  const onboardingComplete = useAppStore((s) => s.onboardingComplete);
  const setOnboardingComplete = useAppStore((s) => s.setOnboardingComplete);
  const { data: projects, isLoading: projectsLoading } = useProjects();
  const [step, setStep] = useState(0);

  // Only projects that existed before the wizard started count: adding one in its own step
  // hid the wizard before the Done step
  const hasExistingProjects = step === 0 && (projects?.length ?? 0) > 0;

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
      {/* Capped to the window: a long step scrolls inside instead of pushing its buttons off */}
      <div className="flex max-h-[90vh] w-full max-w-lg flex-col rounded-lg border border-border bg-bg-secondary p-6 shadow-2xl">
        <div className="mb-5 shrink-0">
          <div className="flex items-center justify-center gap-1.5">
            {STEPS.map(({ id }, i) => (
              <div
                key={id}
                className={`h-1 w-8 rounded-full transition-colors ${
                  i <= step ? "bg-accent" : "bg-white/10"
                }`}
              />
            ))}
          </div>
          <p className="mt-2 text-center text-[10px] text-text-muted">
            Step {step + 1} of {STEPS.length} · {STEPS[step]?.label}
          </p>
        </div>

        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
          {step === 0 && <WelcomeStep onNext={next} />}
          {step === 1 && (
            <CliDoctorStep
              onNext={next}
              onBack={back}
              title="Your agent CLIs"
              description="The coding agents found on this Mac. Others can be installed any time."
              categories={["agents"]}
            />
          )}
          {step === 2 && (
            <CliDoctorStep
              onNext={next}
              onBack={back}
              title="System & services"
              description="Git, the terminal engine and the local services Exegol relies on."
              categories={["system", "config"]}
            />
          )}
          {step === 3 && <ApiKeysStep onNext={next} onBack={back} />}
          {step === 4 && <FirstProjectStep onNext={next} onBack={back} onSkip={next} />}
          {step === 5 && <DoneStep onFinish={finish} />}
        </div>

        {step > 0 && step < STEP_COUNT - 1 && (
          <div className="mt-4 shrink-0 text-center">
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
