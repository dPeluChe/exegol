import type { Settings } from "@exegol/shared";
import { Input } from "@exegol/ui";

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <div className="block text-xs font-medium text-text-secondary">{children}</div>;
}

export interface TerminalSettingsProps {
  settings: Pick<Settings, "terminalFontSize" | "terminalFontFamily">;
  onChange: (updates: Partial<Settings>) => void;
}

export function TerminalSettings({ settings, onChange }: TerminalSettingsProps) {
  return (
    <div className="space-y-4 rounded-lg border border-border bg-bg-secondary p-4">
      <div className="space-y-1.5">
        <FieldLabel>Font Size</FieldLabel>
        <Input
          type="number"
          min={8}
          max={32}
          value={settings.terminalFontSize}
          onChange={(e) => onChange({ terminalFontSize: Number(e.target.value) })}
          className="w-24 border-[var(--border)] bg-[var(--bg-tertiary)] text-[var(--text-primary)]"
        />
      </div>
      <div className="space-y-1.5">
        <FieldLabel>Font Family</FieldLabel>
        <Input
          value={settings.terminalFontFamily}
          onChange={(e) => onChange({ terminalFontFamily: e.target.value })}
          placeholder="JetBrains Mono, Menlo, Monaco, monospace"
          className="border-[var(--border)] bg-[var(--bg-tertiary)] text-[var(--text-primary)]"
        />
      </div>
    </div>
  );
}
