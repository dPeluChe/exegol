import type { IdeType, Settings } from "@exegol/shared";
import { cn, Input } from "@exegol/ui";
import { useQuery } from "@tanstack/react-query";
import {
  AlertCircle,
  Bell,
  Check,
  Loader2,
  MessageSquare,
  Monitor,
  Moon,
  Palette,
  RefreshCw,
  Sun,
} from "lucide-react";
import { useState } from "react";
import { appKeys, IS_MAC } from "../../lib/keymap";
import { openInBrowser } from "../../lib/open-in-browser";
import { displayAccelerator } from "../../lib/shortcuts";
import { trpcInvoke } from "../../lib/trpc-client";
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
  { value: "dark-black", label: "OLED Black", icon: Monitor },
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

/** Electron accelerator for a key press, or null while only modifiers are held */
function acceleratorFor(e: React.KeyboardEvent): string | null {
  const key = e.key;
  if (["Meta", "Control", "Shift", "Alt"].includes(key)) return null;
  const mods = [
    e.metaKey && "CommandOrControl",
    e.ctrlKey && !e.metaKey && "Control",
    e.altKey && "Alt",
    e.shiftKey && "Shift",
  ].filter(Boolean);
  if (mods.length === 0) return null; // a bare key as a global hotkey would swallow typing
  // e.code keeps the letter when Option turns e.key into a symbol
  const base = /^Key[A-Z]$/.test(e.code)
    ? e.code.slice(3)
    : /^Digit\d$/.test(e.code)
      ? e.code.slice(5)
      : key.length === 1
        ? key.toUpperCase()
        : key;
  return [...mods, base].join("+");
}

/**
 * Press the combination to set it: saved once, when complete. Typing it as text saved every
 * keystroke, and a half-typed accelerator unregistered the working hotkey.
 */
function HotkeyRecorder({ onRecord }: { onRecord: (accelerator: string) => void }) {
  const [recording, setRecording] = useState(false);
  return (
    <button
      type="button"
      onClick={() => setRecording(true)}
      onBlur={() => setRecording(false)}
      onKeyDown={(e) => {
        if (!recording) return;
        e.preventDefault();
        if (e.key === "Escape") {
          setRecording(false);
          return;
        }
        const accelerator = acceleratorFor(e);
        if (!accelerator) return;
        setRecording(false);
        onRecord(accelerator);
      }}
      className={cn(
        "rounded border px-2 py-0.5 text-[10px]",
        recording
          ? "border-accent text-accent"
          : "border-border text-text-muted hover:text-text-secondary",
      )}
    >
      {recording ? "Press the keys... (Esc cancels)" : "Change"}
    </button>
  );
}

function KeyCombo({ combo }: { combo: string }) {
  // Parse "CommandOrControl+Shift+E" into visual keys (glyphs on macOS, words elsewhere)
  const parts = !IS_MAC
    ? displayAccelerator(combo).split("+")
    : combo.split("+").map((part) => {
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

interface GeneralSettingsProps {
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
            <HotkeyRecorder onRecord={(globalHotkey) => onChange({ globalHotkey })} />
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

      {/* Notifications */}
      <div>
        <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-text-muted">
          Notifications
        </h3>
        <div className="flex flex-col gap-2">
          {[
            {
              key: "notificationsEnabled" as const,
              label: "System notifications",
              description: "Show OS-level notifications when agents finish",
              icon: Bell,
              value: settings.notificationsEnabled,
            },
            {
              key: "toastsEnabled" as const,
              label: "In-app toasts",
              description: "Show toast messages inside the app",
              icon: MessageSquare,
              value: settings.toastsEnabled,
            },
          ].map((opt) => {
            const Icon = opt.icon;
            return (
              <button
                key={opt.key}
                type="button"
                onClick={() => onChange({ [opt.key]: !opt.value })}
                className={cn(
                  "flex items-center gap-3 rounded-xl border px-4 py-3 text-left transition-all",
                  opt.value
                    ? "border-accent bg-accent/10"
                    : "border-border bg-bg-secondary hover:border-accent/30 hover:bg-white/5",
                )}
              >
                <Icon
                  className={cn("h-4 w-4 shrink-0", opt.value ? "text-accent" : "text-text-muted")}
                />
                <div className="flex-1">
                  <p
                    className={cn(
                      "text-xs font-medium",
                      opt.value ? "text-accent" : "text-text-secondary",
                    )}
                  >
                    {opt.label}
                  </p>
                  <p className="text-[10px] text-text-muted">{opt.description}</p>
                </div>
                <div
                  className={cn(
                    "flex h-5 w-9 items-center rounded-full px-0.5 transition-colors",
                    opt.value ? "bg-accent" : "bg-border",
                  )}
                >
                  <div
                    className={cn(
                      "h-4 w-4 rounded-full bg-white shadow transition-transform",
                      opt.value ? "translate-x-4" : "translate-x-0",
                    )}
                  />
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Ollama / Project Indexing status */}
      <OllamaStatusSection settings={settings} onChange={onChange} />

      <p className="text-[10px] text-text-muted">
        Every keyboard shortcut is in the Shortcuts tab (or press {appKeys("Cmd+/")} in the
        workspace).
      </p>
    </div>
  );
}

// ─── T100: Ollama Status Section ────────────────────────────────────────

interface OllamaStatus {
  available: boolean;
  modelInstalled: boolean;
  version?: string;
  error?: string;
}

function OllamaStatusSection({
  settings,
  onChange,
}: {
  settings: Pick<Settings, "ollamaUrl" | "ollamaModel">;
  onChange: (updates: Partial<Settings>) => void;
}) {
  const ollamaUrl = settings.ollamaUrl;
  const model = settings.ollamaModel;

  const {
    data: status,
    isLoading,
    refetch,
    isFetching,
  } = useQuery({
    queryKey: ["ollamaStatus", ollamaUrl, model],
    queryFn: () => trpcInvoke<OllamaStatus>("indexer.ollamaStatus", { url: ollamaUrl, model }),
    staleTime: 30_000,
    retry: false,
  });

  const isOk = status?.available && status.modelInstalled;

  return (
    <div>
      <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-text-muted">
        Project Indexing (Ollama)
      </h3>
      <div className="space-y-3 rounded-xl border border-border bg-bg-secondary p-4">
        <p className="text-[10px] text-text-muted">
          Exegol can index your project files using local embeddings via Ollama. This enables
          semantic search for agents and PR review.
        </p>

        {/* Ollama URL */}
        <div className="flex items-center gap-3">
          <label
            className="shrink-0 text-[10px] font-medium text-text-secondary"
            htmlFor="ollama-url"
          >
            Ollama URL
          </label>
          <Input
            id="ollama-url"
            value={ollamaUrl}
            onChange={(e) => onChange({ ollamaUrl: e.target.value })}
            className="h-7 flex-1 border-[var(--border)] bg-[var(--bg-tertiary)] text-[10px] text-[var(--text-primary)]"
          />
        </div>

        {/* Model */}
        <div className="flex items-center gap-3">
          <label
            className="shrink-0 text-[10px] font-medium text-text-secondary"
            htmlFor="ollama-model"
          >
            Model
          </label>
          <Input
            id="ollama-model"
            value={model}
            onChange={(e) => onChange({ ollamaModel: e.target.value })}
            className="h-7 flex-1 border-[var(--border)] bg-[var(--bg-tertiary)] text-[10px] text-[var(--text-primary)]"
          />
        </div>

        {/* Status indicator */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => refetch()}
            disabled={isFetching}
            className="flex h-7 items-center gap-1.5 rounded-md border border-border bg-bg-tertiary px-2.5 text-[10px] font-medium text-text-secondary transition-colors hover:bg-white/5 disabled:opacity-50"
          >
            {isFetching ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <RefreshCw className="h-3 w-3" />
            )}
            {isLoading ? "Checking..." : "Verify Connection"}
          </button>

          {status && !isFetching && (
            <div className="flex items-center gap-1.5">
              {isOk ? (
                <>
                  <Check className="h-3.5 w-3.5 text-green-400" />
                  <span className="text-[10px] text-green-400">
                    Connected (v{status.version}) — {model} ready
                  </span>
                </>
              ) : status.available ? (
                <>
                  <AlertCircle className="h-3.5 w-3.5 text-amber-400" />
                  <span className="text-[10px] text-amber-400">{status.error}</span>
                </>
              ) : (
                <>
                  <AlertCircle className="h-3.5 w-3.5 text-red-400" />
                  <span className="text-[10px] text-red-400">{status.error}</span>
                </>
              )}
            </div>
          )}
        </div>

        {/* Install hint */}
        {status && !status.available && (
          <div className="rounded-md border border-border/50 bg-bg-tertiary p-2.5 text-[10px] text-text-muted">
            <p className="font-medium text-text-secondary">Install Ollama:</p>
            <p className="mt-1">
              <code className="rounded bg-white/5 px-1 py-0.5">brew install ollama</code> or
              download from{" "}
              <button
                type="button"
                onClick={() => openInBrowser("https://ollama.ai")}
                className="text-accent underline"
              >
                ollama.ai
              </button>
            </p>
            <p className="mt-1">
              Then run: <code className="rounded bg-white/5 px-1 py-0.5">ollama pull {model}</code>
            </p>
          </div>
        )}

        {status?.available && !status.modelInstalled && (
          <div className="rounded-md border border-amber-500/20 bg-amber-500/5 p-2.5 text-[10px] text-amber-300">
            Run: <code className="rounded bg-white/5 px-1 py-0.5">ollama pull {model}</code> to
            install the embedding model.
          </div>
        )}
      </div>
    </div>
  );
}
