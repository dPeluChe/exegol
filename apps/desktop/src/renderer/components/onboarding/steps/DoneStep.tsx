import { Button } from "@exegol/ui";
import { CheckCircle2 } from "lucide-react";
import { appKeys } from "../../../lib/keymap";

/** The few worth knowing on day one (macOS notation, shown per platform); the rest are behind ⌘/ */
const DONE_SHORTCUTS = [
  ["⌘N", "New agent"],
  ["⌘1", "Dashboard"],
  ["⌘2-9", "Tabs with live sessions"],
  ["⌘,", "Settings"],
  ["⌘/", "All shortcuts"],
] as const;

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
      <div className="grid w-full max-w-xs grid-cols-2 gap-x-4 gap-y-1 text-left text-[11px]">
        {DONE_SHORTCUTS.map(([keys, label]) => (
          <div key={keys} className="contents">
            <kbd className="justify-self-end rounded border border-border px-1.5 font-mono text-text-secondary">
              {appKeys(keys)}
            </kbd>
            <span className="text-text-muted">{label}</span>
          </div>
        ))}
      </div>
      <Button onClick={onFinish} className="bg-accent text-white">
        Start using Exegol
      </Button>
    </div>
  );
}
