import type { Settings } from "@exegol/shared";
import { cn } from "@exegol/ui";
import type { LucideIcon } from "lucide-react";
import {
  ArrowLeft,
  AudioLines,
  HardDrive,
  Key,
  Keyboard,
  Monitor,
  Network,
  PanelBottom,
  Settings2,
  Stethoscope,
  Terminal,
} from "lucide-react";
import { type ReactNode, useState } from "react";
import { ApiKeysSettings } from "./ApiKeysSettings";
import { CliSettings } from "./CliSettings";
import { DoctorSettings } from "./DoctorSettings";
import { GeneralSettings } from "./GeneralSettings";
import { KeyboardShortcuts } from "./KeyboardShortcuts";
import { McpServerSettings } from "./McpServerSettings";
import { ModelsSettings } from "./ModelsSettings";
import { StatusBarSettings } from "./StatusBarSettings";
import { StorageSettings } from "./StorageSettings";
import { TerminalSettings } from "./TerminalSettings";
import { useSettingsForm } from "./use-settings-form";

export type SettingsTab =
  | "general"
  | "statusbar"
  | "clis"
  | "terminal"
  | "shortcuts"
  | "apikeys"
  | "mcp"
  | "models"
  | "storage"
  | "doctor";

const TABS: { id: SettingsTab; label: string; icon: LucideIcon }[] = [
  { id: "general", label: "General", icon: Settings2 },
  { id: "statusbar", label: "Status bar", icon: PanelBottom },
  { id: "clis", label: "Agent CLIs", icon: Terminal },
  { id: "terminal", label: "Terminal", icon: Monitor },
  { id: "shortcuts", label: "Shortcuts", icon: Keyboard },
  { id: "apikeys", label: "API Keys", icon: Key },
  { id: "mcp", label: "MCP Server", icon: Network },
  { id: "models", label: "Models", icon: AudioLines },
  { id: "storage", label: "Storage", icon: HardDrive },
  { id: "doctor", label: "Doctor", icon: Stethoscope },
];

interface TabContentProps {
  settings: Settings;
  onChange: (updates: Partial<Settings>) => void;
}

const TAB_CONTENT: Record<SettingsTab, (props: TabContentProps) => ReactNode> = {
  general: (props) => <GeneralSettings {...props} />,
  statusbar: (props) => <StatusBarSettings {...props} />,
  clis: () => <CliSettings />,
  terminal: (props) => <TerminalSettings {...props} />,
  shortcuts: () => <KeyboardShortcuts />,
  apikeys: () => <ApiKeysSettings />,
  mcp: () => <McpServerSettings />,
  models: () => <ModelsSettings />,
  storage: () => <StorageSettings />,
  doctor: () => <DoctorSettings />,
};

interface SettingsPanelProps {
  /** Initial tab selection (used by the standalone settings window for deep-links). */
  initialTab?: SettingsTab;
  /** Called when the back/close button is pressed. Required — there is no in-app embed. */
  onClose: () => void;
}

export function SettingsPanel({ initialTab, onClose }: SettingsPanelProps) {
  const [activeTab, setActiveTab] = useState<SettingsTab>(initialTab ?? "general");

  const { form, isLoading, updateField, showSaved, saveError } = useSettingsForm();

  if (isLoading || !form) {
    return (
      <div className="flex h-full items-center justify-center bg-bg-primary">
        <p className="text-sm text-text-muted">Loading settings...</p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col bg-bg-primary">
      {/* Header — draggable (standalone hiddenInset window); pl-20 clears the
          macOS traffic lights at x:16. Linux and Windows get the system frame instead */}
      <div
        className={cn(
          "titlebar-drag flex items-center gap-3 border-b border-border py-3 pr-4",
          (window.api?.app?.getPlatform?.() ?? "darwin") === "darwin" ? "pl-20" : "pl-4",
        )}
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Back"
          className="titlebar-no-drag flex h-7 w-7 items-center justify-center rounded text-text-muted hover:bg-white/5"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <h1 className="text-base font-semibold text-text-primary">Settings</h1>
        {showSaved && <span className="animate-fade-in text-[10px] text-green-400">Saved</span>}
      </div>

      {/* Body: vertical tabs on left + content on right */}
      <div className="flex flex-1 overflow-hidden">
        <SettingsNav activeTab={activeTab} onSelect={setActiveTab} />

        {/* Tab content */}
        <div className="flex-1 overflow-auto p-6">
          {TAB_CONTENT[activeTab]({ settings: form, onChange: updateField })}

          {saveError !== null && (
            <p className="mt-4 text-xs text-error">Failed to save: {saveError}</p>
          )}
        </div>
      </div>
    </div>
  );
}

function SettingsNav({
  activeTab,
  onSelect,
}: {
  activeTab: SettingsTab;
  onSelect: (tab: SettingsTab) => void;
}) {
  return (
    <nav className="flex w-48 shrink-0 flex-col gap-0.5 border-r border-border bg-bg-secondary p-2">
      {TABS.map((tab) => (
        <button
          type="button"
          key={tab.id}
          onClick={() => onSelect(tab.id)}
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
  );
}
