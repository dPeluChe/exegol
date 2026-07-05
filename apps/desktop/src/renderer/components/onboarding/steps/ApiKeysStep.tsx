import { Button } from "@exegol/ui";
import { ApiKeysSettings } from "../../settings/ApiKeysSettings";

interface ApiKeysStepProps {
  onNext: () => void;
  onBack: () => void;
}

export function ApiKeysStep({ onNext, onBack }: ApiKeysStepProps) {
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-base font-semibold text-text-primary">Add API keys</h2>
        <p className="text-xs text-text-muted">
          Only needed for CLIs that bill by API key (Claude Code, Codex). You can skip this and add
          keys later in Settings.
        </p>
      </div>

      <ApiKeysSettings />

      <div className="flex justify-between pt-2">
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
