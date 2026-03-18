import type { Settings } from "@exegol/shared";
import { Button, cn } from "@exegol/ui";
import type { LucideIcon } from "lucide-react";
import {
  ArrowLeft,
  Key,
  Keyboard,
  Monitor,
  RotateCcw,
  Save,
  Settings2,
  Terminal,
} from "lucide-react";
import { useState } from "react";
import { useSettings, useUpdateSettings } from "../../hooks/use-trpc";
import { useAppStore } from "../../stores/app";
import { ApiKeysSettings } from "./ApiKeysSettings";
import { CliSettings } from "./CliSettings";
import { GeneralSettings } from "./GeneralSettings";
import { KeyboardShortcuts } from "./KeyboardShortcuts";
import { TerminalSettings } from "./TerminalSettings";

type SettingsTab = "general" | "clis" | "terminal" | "shortcuts" | "apikeys";

const TABS: { id: SettingsTab; label: string; icon: LucideIcon }[] = [
  { id: "general", label: "General", icon: Settings2 },
  { id: "clis", label: "Agent CLIs", icon: Terminal },
  { id: "terminal", label: "Terminal", icon: Monitor },
  { id: "shortcuts", label: "Shortcuts", icon: Keyboard },
  { id: "apikeys", label: "API Keys", icon: Key },
];

export function SettingsPanel() {
  const [activeTab, setActiveTab] = useState<SettingsTab>("general");
  const setActiveView = useAppStore((s) => s.setActiveView);
  const activeProjectId = useAppStore((s) => s.activeProjectId);

  const { data: settings, isLoading } = useSettings();
  const updateSettings = useUpdateSettings();

  // Derive initial form state from settings (Rule 1: derive, don't sync)
  const [form, setForm] = useState<Settings | null>(() => settings ?? null);
  const [dirty, setDirty] = useState(false);

  // If settings loaded after initial render (async), initialize form from it
  if (settings && !form) {
    setForm(settings);
  }

  if (isLoading || !form) {
    return (
      <div className="flex h-full items-center justify-center bg-bg-primary">
        <p className="text-sm text-text-muted">Loading settings...</p>
      </div>
    );
  }

  const updateField = (updates: Partial<Settings>) => {
    setForm((prev) => {
      if (!prev) return prev;
      const updated = { ...prev, ...updates };
      // Auto-save on every change
      updateSettings.mutate(updated);
      return updated;
    });
    setDirty(true);
  };

  const handleSave = async () => {
    if (!form) return;
    await updateSettings.mutateAsync(form);
    setDirty(false);
  };

  const handleReset = () => {
    if (settings) {
      setForm(settings);
      setDirty(false);
    }
  };

  return (
    <div className="flex h-full flex-col bg-bg-primary">
      {/* Header with back button + title + save/reset */}
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setActiveView(activeProjectId ? "workspace" : "projects")}
            className="flex h-7 w-7 items-center justify-center rounded text-text-muted hover:bg-white/5"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <h1 className="text-base font-semibold text-text-primary">Settings</h1>
        </div>
        <div className="flex items-center gap-2">
          {dirty && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={handleReset}
              className="gap-1 text-[var(--text-secondary)]"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              Reset
            </Button>
          )}
          <Button
            type="button"
            size="sm"
            onClick={handleSave}
            disabled={!dirty || updateSettings.isPending}
            className={cn("gap-1 text-white", dirty && "bg-accent")}
          >
            <Save className="h-3.5 w-3.5" />
            {updateSettings.isPending ? "Saving..." : "Save"}
          </Button>
        </div>
      </div>

      {/* Body: vertical tabs on left + content on right */}
      <div className="flex flex-1 overflow-hidden">
        {/* Tab nav - left sidebar */}
        <nav className="flex w-48 shrink-0 flex-col gap-0.5 border-r border-border bg-bg-secondary p-2">
          {TABS.map((tab) => (
            <button
              type="button"
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                "flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors",
                activeTab === tab.id
                  ? "bg-white/10 text-text-primary"
                  : "text-text-muted hover:bg-white/5 hover:text-text-secondary",
              )}
            >
              <tab.icon className="h-4 w-4" />
              {tab.label}
            </button>
          ))}
        </nav>

        {/* Tab content - right area */}
        <div className="flex-1 overflow-auto p-6">
          {activeTab === "general" && <GeneralSettings settings={form} onChange={updateField} />}
          {activeTab === "clis" && (
            <CliSettings
              clis={form.agentClis}
              onChange={(clis) => updateField({ agentClis: clis })}
            />
          )}
          {activeTab === "terminal" && <TerminalSettings settings={form} onChange={updateField} />}
          {activeTab === "shortcuts" && <KeyboardShortcuts />}
          {activeTab === "apikeys" && <ApiKeysSettings />}

          {/* Save error */}
          {updateSettings.isError && (
            <p className="mt-4 text-xs text-error">
              Failed to save settings:{" "}
              {updateSettings.error instanceof Error
                ? updateSettings.error.message
                : "Unknown error"}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
