import type { Settings } from "@exegol/shared";
import { Input } from "@exegol/ui";
import { RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { FamilyBadge } from "./terminal-settings/FamilyBadge";
import { FontGroup } from "./terminal-settings/FontGroup";
import {
  isFontInstalled,
  NERD_PREVIEW,
  normalizeFamily,
  PLAIN_PREVIEW,
  RECOMMENDED_FONTS,
} from "./terminal-settings/recommended-fonts";

// ─── Component ──────────────────────────────────────────────────────────────

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <div className="block text-xs font-medium text-text-secondary">{children}</div>;
}

export interface TerminalSettingsProps {
  settings: Pick<Settings, "terminalFontSize" | "terminalFontFamily">;
  onChange: (updates: Partial<Settings>) => void;
}

export function TerminalSettings({ settings, onChange }: TerminalSettingsProps) {
  const [fontStatus, setFontStatus] = useState<Record<string, boolean>>({});

  const detectFonts = useCallback(() => {
    const status: Record<string, boolean> = {};
    for (const font of RECOMMENDED_FONTS) {
      // Bundled fonts are loaded via @font-face in fonts.css — always
      // present, no need to probe the canvas. (Canvas detection also
      // doesn't work reliably for recently-@font-face'd fonts because
      // they may not be fully loaded yet on first paint.)
      status[font.family] = font.bundled ? true : isFontInstalled(font.family);
    }
    setFontStatus(status);
  }, []);

  // Detect installed fonts on mount
  useEffect(() => {
    detectFonts();
  }, [detectFonts]);

  const handleSelectFont = (family: string) => {
    const target = normalizeFamily(family);
    const parts = settings.terminalFontFamily
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    // Remove any existing entry for this family (in any quoting/case)
    const filtered = parts.filter((p) => normalizeFamily(p) !== target);
    // Prepend — quote multi-word families so CSS parses them unambiguously
    const quoted = family.includes(" ") ? `"${family}"` : family;
    const newFamily = [quoted, ...filtered].join(", ");
    onChange({ terminalFontFamily: newFamily });
  };

  const handleDeselectFont = (family: string) => {
    // Remove this family from the fallback chain. If nothing sensible is
    // left, reset to the system default so the terminal never ends up
    // with an empty font stack.
    const target = normalizeFamily(family);
    const parts = settings.terminalFontFamily
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const filtered = parts.filter((p) => normalizeFamily(p) !== target);
    const next = filtered.length > 0 ? filtered.join(", ") : "Menlo, Monaco, monospace";
    onChange({ terminalFontFamily: next });
  };

  // Parse the comma-separated font family chain into individual families
  // for the badge UI. Handles quoted entries ("My Font") and trims quotes.
  const familyChain = settings.terminalFontFamily
    .split(",")
    .map((s) => s.trim().replace(/^["']|["']$/g, ""))
    .filter(Boolean);

  return (
    <div className="space-y-5">
      {/* Top card: Size + Family chain as badges + live preview */}
      <div className="space-y-3 rounded-lg border border-border bg-bg-secondary p-4">
        <div className="flex items-start gap-4">
          {/* Font Size */}
          <div className="shrink-0 space-y-1.5">
            <FieldLabel>Font Size</FieldLabel>
            <Input
              type="number"
              min={8}
              max={32}
              value={settings.terminalFontSize}
              onChange={(e) => onChange({ terminalFontSize: Number(e.target.value) })}
              className="w-20 border-[var(--border)] bg-[var(--bg-tertiary)] text-[var(--text-primary)]"
            />
          </div>

          {/* Font Family chain as badges */}
          <div className="min-w-0 flex-1 space-y-1.5">
            <div className="flex items-center justify-between">
              <FieldLabel>Font Family (fallback chain)</FieldLabel>
              <button
                type="button"
                onClick={detectFonts}
                className="flex items-center gap-1 text-[9px] text-text-muted hover:text-text-secondary"
                title="Re-detect installed fonts"
              >
                <RefreshCw className="h-3 w-3" />
                Detect
              </button>
            </div>
            <div className="flex flex-wrap items-center gap-1 rounded-md border border-[var(--border)] bg-[var(--bg-tertiary)] p-1.5 min-h-[30px]">
              {familyChain.length === 0 ? (
                <span className="px-1 text-[10px] text-text-muted">No fonts selected</span>
              ) : (
                familyChain.map((family, index) => (
                  <FamilyBadge
                    key={family}
                    family={family}
                    isPrimary={index === 0}
                    onPromote={() => handleSelectFont(family)}
                    onRemove={() => handleDeselectFont(family)}
                  />
                ))
              )}
            </div>
            <p className="text-[9px] text-text-muted">
              First badge is primary. Click another to promote it, <kbd>×</kbd> to remove, or pick a
              new one from below.
            </p>
          </div>
        </div>

        {/* Preview rendered with the current chain */}
        <div className="rounded-md border border-[var(--border)] bg-[var(--bg-tertiary)] p-2.5">
          <p className="mb-1 text-[9px] uppercase tracking-wider text-text-muted">Preview</p>
          <pre
            className="overflow-x-auto text-sm text-text-primary leading-relaxed"
            style={{
              fontFamily: settings.terminalFontFamily,
              fontSize: `${settings.terminalFontSize}px`,
            }}
          >
            {'$ echo "Hello from Exegol"'}
            {"\n"}
            {NERD_PREVIEW}
            {"\n"}
            {/* Nerd Font dev icons — nf-dev-* codepoints from nerdfonts.com */}
            {"\ue718 node  \ue73c python  \ue7a8 rust  \ue738 java  \ue755 swift"}
          </pre>
        </div>
      </div>

      {/* Font groups: bundled first, then external */}
      <div className="space-y-5">
        <FontGroup
          title="Bundled with Exegol"
          subtitle="Nerd Fonts shipped inside the app — no install required"
          fonts={RECOMMENDED_FONTS.filter((f) => f.bundled)}
          fontStatus={fontStatus}
          activeFamily={settings.terminalFontFamily}
          nerdPreview={NERD_PREVIEW}
          plainPreview={PLAIN_PREVIEW}
          onSelect={handleSelectFont}
          onDeselect={handleDeselectFont}
        />
        <FontGroup
          title="External fonts"
          subtitle="Install from your OS to enable these in Exegol"
          fonts={RECOMMENDED_FONTS.filter((f) => !f.bundled)}
          fontStatus={fontStatus}
          activeFamily={settings.terminalFontFamily}
          nerdPreview={NERD_PREVIEW}
          plainPreview={PLAIN_PREVIEW}
          onSelect={handleSelectFont}
          onDeselect={handleDeselectFont}
        />
      </div>
    </div>
  );
}
