import { Button } from "@exegol/ui";
import { Sparkles } from "lucide-react";

interface WelcomeStepProps {
  onNext: () => void;
}

export function WelcomeStep({ onNext }: WelcomeStepProps) {
  return (
    <div className="flex flex-col items-center gap-4 py-8 text-center">
      <Sparkles className="h-10 w-10 text-accent" />
      <h2 className="text-lg font-semibold text-text-primary">Welcome to Exegol</h2>
      <p className="max-w-sm text-sm text-text-muted">
        One place for all your AI coding agents — Claude Code, Codex, Gemini, and more. Let's get
        you set up in under two minutes.
      </p>
      <Button onClick={onNext} className="bg-accent text-white">
        Get started
      </Button>
    </div>
  );
}
