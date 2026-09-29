import { Button } from "@exegol/ui";
import { ApiKeysSettings } from "../../settings/ApiKeysSettings";

interface ApiKeysStepProps {
  onNext: () => void;
  onBack: () => void;
}

export function ApiKeysStep({ onNext, onBack }: ApiKeysStepProps) {
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <div>
        <h2 className="text-base font-semibold text-text-primary">Add API keys</h2>
        <p className="text-xs text-text-muted">
          Only needed for CLIs that bill by API key (Claude Code, Codex). You can skip this and add
          keys later in Settings.
        </p>
      </div>

      {/* The keys panel scrolls; Back / Continue stay in view, like the Doctor steps */}
      <div className="min-h-0 flex-1 overflow-y-auto pr-1">
        <ApiKeysSettings />
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
