import { Button } from "@exegol/ui";
import { CheckCircle2 } from "lucide-react";

interface DoneStepProps {
  onFinish: () => void;
}

export function DoneStep({ onFinish }: DoneStepProps) {
  return (
    <div className="flex flex-col items-center gap-4 py-8 text-center">
      <CheckCircle2 className="h-10 w-10 text-success" />
      <h2 className="text-lg font-semibold text-text-primary">You're all set</h2>
      <p className="max-w-sm text-sm text-text-muted">
        Spawn an agent from the launcher whenever you're ready. You can revisit setup anytime from
        Settings → Doctor.
      </p>
      <Button onClick={onFinish} className="bg-accent text-white">
        Start using Exegol
      </Button>
    </div>
  );
}
