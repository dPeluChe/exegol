import { Button } from "@exegol/ui";
import * as Dialog from "@radix-ui/react-dialog";
import { useState } from "react";
import { useAppStore } from "../../stores/app";
import { WELCOME_TOUR_STEPS } from "./welcome-tour-steps";

const LAST = WELCOME_TOUR_STEPS.length - 1;

/** Shown once after the first-run wizard; the command palette reopens it */
export function WelcomeTour() {
  const onboardingComplete = useAppStore((s) => s.onboardingComplete);
  const welcomeTourSeen = useAppStore((s) => s.welcomeTourSeen);
  const open = onboardingComplete && !welcomeTourSeen;
  // Unmounted while closed, so a reopen starts at the first step
  return open ? <WelcomeTourDialog /> : null;
}

function WelcomeTourDialog() {
  const setWelcomeTourSeen = useAppStore((s) => s.setWelcomeTourSeen);
  const [step, setStep] = useState(0);
  const current = WELCOME_TOUR_STEPS[step];
  const finish = () => setWelcomeTourSeen(true);

  if (!current) return null;

  return (
    <Dialog.Root
      open
      onOpenChange={(next) => {
        if (!next) finish();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50" />
        <Dialog.Content className="fixed left-1/2 top-[15%] z-50 flex max-h-[80vh] w-full max-w-md -translate-x-1/2 flex-col gap-4 rounded-xl border border-border bg-bg-secondary p-5 shadow-2xl">
          <div className="flex items-center justify-between">
            <p className="text-[10px] uppercase tracking-wider text-text-muted">
              Tour · {step + 1} of {WELCOME_TOUR_STEPS.length}
            </p>
            <button
              type="button"
              onClick={finish}
              className="text-[11px] text-text-muted hover:text-text-secondary"
            >
              Skip tour
            </button>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto">
            <Dialog.Title className="mb-2 text-sm font-semibold text-text-primary">
              {current.title}
            </Dialog.Title>
            <Dialog.Description asChild>
              <ul className="list-disc space-y-1 pl-4 text-xs text-text-secondary">
                {current.bullets.map((bullet) => (
                  <li key={bullet}>{bullet}</li>
                ))}
              </ul>
            </Dialog.Description>
          </div>

          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              {WELCOME_TOUR_STEPS.map(({ title }, i) => (
                <button
                  key={title}
                  type="button"
                  aria-label={`Step ${i + 1}: ${title}`}
                  aria-current={i === step ? "step" : undefined}
                  onClick={() => setStep(i)}
                  className={`h-1.5 w-1.5 rounded-full transition-colors ${
                    i === step ? "bg-accent" : "bg-white/20 hover:bg-white/40"
                  }`}
                />
              ))}
            </div>
            <div className="flex gap-2">
              {step > 0 && (
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setStep(step - 1)}
                  className="text-text-secondary"
                >
                  Back
                </Button>
              )}
              {step < LAST ? (
                <Button
                  type="button"
                  onClick={() => setStep(step + 1)}
                  className="bg-accent text-white"
                >
                  Next
                </Button>
              ) : (
                <Button type="button" onClick={finish} className="bg-accent text-white">
                  Get started
                </Button>
              )}
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
