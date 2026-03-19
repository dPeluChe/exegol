import type { IdeType, Settings } from "@exegol/shared";
import { cn, Input } from "@exegol/ui";
import { Moon, Palette, Sun } from "lucide-react";
import { AgentIcon } from "../common/AgentIcon";

// ─── IDE options with icon metadata ─────────────────────────────────────────

const IDE_OPTIONS: { value: IdeType; label: string; icon: string; color: string }[] = [
  { value: "vscode", label: "VS Code", icon: "VS", color: "#007ACC" },
  { value: "cursor", label: "Cursor", icon: "Cu", color: "#000000" },
  { value: "zed", label: "Zed", icon: "Ze", color: "#084CCF" },
  { value: "windsurf", label: "Windsurf", icon: "Wi", color: "#00C4B4" },
  { value: "custom", label: "Custom", icon: "⚙", color: "#6B7280" },
];

const THEME_OPTIONS = [
  { value: "dark", label: "Dark", icon: Moon },
  { value: "light", label: "Light", icon: Sun },
  { value: "system", label: "System", icon: Palette },
] as const;

// ─── Keystroke visual component ─────────────────────────────────────────────

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="inline-flex h-6 min-w-6 items-center justify-center rounded-md border border-border/80 bg-bg-tertiary px-1.5 text-[10px] font-medium text-text-secondary shadow-[0_1px_0_1px_rgba(0,0,0,0.3)]">
      {children}
    </kbd>
  );
}

function KeyCombo({ combo }: { combo: string }) {
  // Parse "CommandOrControl+Shift+E" into visual keys
  const parts = combo.split("+").map((part) => {
    switch (part.toLowerCase()) {
      case "commandorcontrol":
      case "command":
      case "cmd":
        return "⌘";
      case "control":
      case "ctrl":
        return "⌃";
      case "shift":
        return "⇧";
      case "alt":
      case "option":
        return "⌥";
      case "meta":
        return "⌘";
      default:
        return part.toUpperCase();
    }
  });

  return (
    <div className="flex items-center gap-0.5">
      {parts.map((key, pos) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: position is the only unique identifier for key parts
        <Kbd key={pos}>{key}</Kbd>
      ))}
    </div>
  );
}

// ─── Component ──────────────────────────────────────────────────────────────

export interface GeneralSettingsProps {
  settings: Settings;
  onChange: (updates: Partial<Settings>) => void;
}

export function GeneralSettings({ settings, onChange }: GeneralSettingsProps) {
  return (
    <div className="space-y-6">
      {/* Theme + Hotkey in same row */}
      <div className="flex items-start gap-6">
        <div>
          <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-text-muted">
            Theme
          </h3>
          <div className="flex gap-2">
            {THEME_OPTIONS.map((opt) => {
              const isActive = settings.theme === opt.value;
              const Icon = opt.icon;
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => onChange({ theme: opt.value as Settings["theme"] })}
                  className={cn(
                    "flex items-center gap-2 rounded-xl border px-4 py-2.5 text-xs font-medium transition-all",
                    isActive
                      ? "border-accent bg-accent/10 text-accent"
                      : "border-border bg-bg-secondary text-text-muted hover:border-accent/30 hover:bg-white/5",
                  )}
                >
                  <Icon className="h-4 w-4" />
                  {opt.label}
                </button>
              );
            })}
          </div>
        </div>

        <div>
          <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-text-muted">
            Global Hotkey
          </h3>
          <div className="flex items-center gap-3 rounded-xl border border-border bg-bg-secondary px-4 py-2.5">
            <KeyCombo combo={settings.globalHotkey} />
            <details className="group">
              <summary className="cursor-pointer text-[9px] text-text-muted hover:text-text-secondary">
                edit
              </summary>
              <Input
                value={settings.globalHotkey}
                onChange={(e) => onChange({ globalHotkey: e.target.value })}
                placeholder="CommandOrControl+Shift+E"
                className="mt-1 w-48 border-[var(--border)] bg-[var(--bg-tertiary)] text-[10px] text-[var(--text-primary)]"
              />
            </details>
          </div>
        </div>
      </div>

      {/* IDE selector */}
      <div>
        <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-text-muted">
          Default IDE
        </h3>
        <div className="grid grid-cols-3 gap-2 xl:grid-cols-6">
          {IDE_OPTIONS.map((opt) => {
            const isActive = settings.defaultIde === opt.value;
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => onChange({ defaultIde: opt.value })}
                className={cn(
                  "flex flex-col items-center gap-1.5 rounded-xl border p-3 transition-all",
                  isActive
                    ? "border-accent bg-accent/10"
                    : "border-border bg-bg-secondary hover:border-accent/30 hover:bg-white/5",
                )}
              >
                <AgentIcon
                  provider={opt.value}
                  size={28}
                  fallback={opt.icon}
                  fallbackColor={opt.color}
                />
                <span
                  className={cn(
                    "text-[10px] font-medium",
                    isActive ? "text-accent" : "text-text-secondary",
                  )}
                >
                  {opt.label}
                </span>
              </button>
            );
          })}
        </div>
        {settings.defaultIde === "custom" && (
          <div className="mt-2">
            <Input
              value={settings.customIdePath ?? ""}
              onChange={(e) => onChange({ customIdePath: e.target.value || null })}
              placeholder="/usr/local/bin/my-editor"
              className="border-[var(--border)] bg-[var(--bg-tertiary)] text-[var(--text-primary)]"
            />
          </div>
        )}
      </div>

      {/* Keyboard shortcuts reference */}
      <div>
        <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-text-muted">
          Quick Reference
        </h3>
        <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 rounded-xl border border-border bg-bg-secondary p-4">
          {[
            { keys: "⌘+B", desc: "Toggle sidebar" },
            { keys: "⌘+T", desc: "New tab" },
            { keys: "⌘+W", desc: "Close pane/tab" },
            { keys: "⌘+D", desc: "Split horizontal" },
            { keys: "⌘+⇧+D", desc: "Split vertical" },
            { keys: "⌘+,", desc: "Settings" },
            { keys: "⌘+1-9", desc: "Switch agent" },
            { keys: "⌘+[/]", desc: "Navigate tabs" },
          ].map(({ keys, desc }) => (
            <div key={keys} className="flex items-center justify-between py-0.5">
              <span className="text-[10px] text-text-muted">{desc}</span>
              <div className="flex items-center gap-0.5">
                {keys.split("+").map((k) => (
                  <Kbd key={`${keys}-${k}`}>{k}</Kbd>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
