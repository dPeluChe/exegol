import type { Settings } from "@exegol/shared";
import { cn, Input } from "@exegol/ui";
import { Check, Download, RefreshCw, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

// ─── Recommended fonts with install URLs ────────────────────────────────────
//
// Nerd Fonts are listed first and labeled so users with oh-my-zsh /
// powerlevel10k themes get their icons rendering in xterm.js. Family
// names must match EXACTLY what the OS reports (check with
// `system_profiler SPFontsDataType` on macOS or `fc-list` on Linux).
//
// Mono variants are preferred over proportional for terminals because
// xterm.js assumes fixed-width cells.

const RECOMMENDED_FONTS: {
  name: string;
  family: string;
  description: string;
  url: string;
  nerdFont: boolean;
  /** Bundled inside the app — no install required. Always available. */
  bundled?: boolean;
}[] = [
  // ── Bundled Nerd Fonts (shipped inside the .app, no install needed) ───
  {
    name: "MesloLGS NF",
    family: "MesloLGS NF",
    description: "Powerlevel10k recommended — bundled, no install needed",
    url: "https://github.com/romkatv/powerlevel10k#manual-font-installation",
    nerdFont: true,
    bundled: true,
  },
  {
    name: "FiraCode Nerd Font",
    family: "FiraCode Nerd Font Mono",
    description: "Ligatures + Nerd Font icons — bundled, no install needed",
    url: "https://www.nerdfonts.com/font-downloads",
    nerdFont: true,
    bundled: true,
  },
  {
    name: "JetBrainsMono Nerd Font",
    family: "JetBrainsMono Nerd Font Mono",
    description: "JetBrains Mono with Nerd Font icons — bundled",
    url: "https://www.nerdfonts.com/font-downloads",
    nerdFont: true,
    bundled: true,
  },
  {
    name: "Hack Nerd Font",
    family: "Hack Nerd Font Mono",
    description: "Hack with Nerd Font icons",
    url: "https://www.nerdfonts.com/font-downloads",
    nerdFont: true,
  },
  {
    name: "CaskaydiaCove Nerd Font",
    family: "CaskaydiaCove Nerd Font Mono",
    description: "Microsoft Cascadia Code with Nerd Font icons",
    url: "https://www.nerdfonts.com/font-downloads",
    nerdFont: true,
  },
  {
    name: "Iosevka Nerd Font",
    family: "Iosevka Nerd Font Mono",
    description: "Narrow, tall, modular — popular with tiling WMs",
    url: "https://www.nerdfonts.com/font-downloads",
    nerdFont: true,
  },
  {
    name: "SauceCodePro Nerd Font",
    family: "SauceCodePro Nerd Font Mono",
    description: "Source Code Pro with Nerd Font icons",
    url: "https://www.nerdfonts.com/font-downloads",
    nerdFont: true,
  },
  // ── Powerline fonts (subset of Nerd Fonts — only powerline glyphs) ────
  {
    name: "Meslo LG M for Powerline",
    family: "Meslo LG M for Powerline",
    description: "oh-my-zsh agnoster/powerline themes",
    url: "https://github.com/powerline/fonts",
    nerdFont: true,
  },
  // ── Plain monospace (no icons) ────────────────────────────────────────
  {
    name: "JetBrains Mono",
    family: "JetBrains Mono",
    description: "Popular dev font by JetBrains (no icons)",
    url: "https://www.jetbrains.com/lp/mono/",
    nerdFont: false,
  },
  {
    name: "Hack",
    family: "Hack",
    description: "Clean monospace for terminals",
    url: "https://sourcefoundry.org/hack/",
    nerdFont: false,
  },
  {
    name: "SF Mono",
    family: "SF Mono",
    description: "Apple's system mono — install via Terminal.app preferences",
    url: "",
    nerdFont: false,
  },
  {
    name: "Menlo",
    family: "Menlo",
    description: "macOS system monospace (always available)",
    url: "",
    nerdFont: false,
  },
];

/** Detect if a font is available using canvas measurement */
function isFontInstalled(family: string): boolean {
  if (typeof document === "undefined") return false;
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) return false;

  const testStr = "abcdefghijklmnopqrstuvwxyz0123456789";
  ctx.font = `16px monospace`;
  const defaultWidth = ctx.measureText(testStr).width;

  ctx.font = `16px "${family}", monospace`;
  const testWidth = ctx.measureText(testStr).width;

  return testWidth !== defaultWidth;
}

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
    // Prepend selected font to existing fallback chain, keep monospace at end
    const current = settings.terminalFontFamily;
    const parts = current
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    // Remove if already in list
    const filtered = parts.filter((p) => p !== family && p !== `"${family}"`);
    // Prepend
    const newFamily = [family, ...filtered].join(", ");
    onChange({ terminalFontFamily: newFamily });
  };

  const handleDeselectFont = (family: string) => {
    // Remove this family from the fallback chain. If nothing sensible is
    // left, reset to the system default so the terminal never ends up
    // with an empty font stack.
    const parts = settings.terminalFontFamily
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const filtered = parts.filter((p) => p !== family && p !== `"${family}"`);
    const next = filtered.length > 0 ? filtered.join(", ") : "Menlo, Monaco, monospace";
    onChange({ terminalFontFamily: next });
  };

  // Sample string that exercises the full Nerd Font glyph spectrum +
  // common powerline separators + dev symbols + ligatures. If a card
  // renders these as boxes/tofu, the font isn't actually loaded.
  const NERD_PREVIEW = "\ue7c5 \ue7a8 \uf013 \uf1d3 \ue0b0 \ue0b2  == => !=";
  const PLAIN_PREVIEW = "$ echo hello   == => != <$>";

  return (
    <div className="space-y-5">
      {/* Font size + family */}
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
            placeholder="Menlo, Monaco, monospace"
            className="border-[var(--border)] bg-[var(--bg-tertiary)] text-[var(--text-primary)]"
          />
          <p className="text-[9px] text-text-muted">
            Click a font below to set it as primary. Fallback fonts are kept.
          </p>
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
          trailing={
            <button
              type="button"
              onClick={detectFonts}
              className="flex items-center gap-1 text-[9px] text-text-muted hover:text-text-secondary"
              title="Re-detect installed fonts"
            >
              <RefreshCw className="h-3 w-3" />
              Detect
            </button>
          }
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

      {/* Live preview of the current fallback chain */}
      <div className="rounded-lg border border-border bg-bg-tertiary p-3">
        <p className="mb-1 text-[9px] text-text-muted">Preview (current font chain)</p>
        <pre
          className="text-sm text-text-primary leading-relaxed"
          style={{ fontFamily: settings.terminalFontFamily }}
        >
          {'$ echo "Hello from Exegol"'}
          {"\n"}
          {NERD_PREVIEW}
          {"\n"}
          {"\ue627 node  \ue61e python  \ue7a8 rust  \ue738 java  \ue781 swift"}
        </pre>
      </div>
    </div>
  );
}

// ─── FontGroup ──────────────────────────────────────────────────────────────

interface FontGroupProps {
  title: string;
  subtitle: string;
  fonts: (typeof RECOMMENDED_FONTS)[number][];
  fontStatus: Record<string, boolean>;
  activeFamily: string;
  nerdPreview: string;
  plainPreview: string;
  onSelect: (family: string) => void;
  onDeselect: (family: string) => void;
  trailing?: React.ReactNode;
}

function FontGroup({
  title,
  subtitle,
  fonts,
  fontStatus,
  activeFamily,
  nerdPreview,
  plainPreview,
  onSelect,
  onDeselect,
  trailing,
}: FontGroupProps) {
  if (fonts.length === 0) return null;
  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <div>
          <h3 className="text-[10px] font-semibold uppercase tracking-wider text-text-muted">
            {title}
          </h3>
          <p className="text-[9px] text-text-muted/70">{subtitle}</p>
        </div>
        {trailing}
      </div>
      <div className="space-y-1">
        {fonts.map((font) => (
          <FontCard
            key={font.family}
            font={font}
            installed={fontStatus[font.family] ?? false}
            isActive={activeFamily
              .split(",")
              .map((s) => s.trim())
              .some((s) => s === font.family || s === `"${font.family}"`)}
            nerdPreview={nerdPreview}
            plainPreview={plainPreview}
            onSelect={onSelect}
            onDeselect={onDeselect}
          />
        ))}
      </div>
    </div>
  );
}

// ─── FontCard ───────────────────────────────────────────────────────────────

interface FontCardProps {
  font: (typeof RECOMMENDED_FONTS)[number];
  installed: boolean;
  isActive: boolean;
  nerdPreview: string;
  plainPreview: string;
  onSelect: (family: string) => void;
  onDeselect: (family: string) => void;
}

function FontCard({
  font,
  installed,
  isActive,
  nerdPreview,
  plainPreview,
  onSelect,
  onDeselect,
}: FontCardProps) {
  return (
    <div
      className={cn(
        "flex items-center gap-3 rounded-lg border bg-bg-secondary p-2.5",
        isActive ? "border-accent/50" : "border-border",
      )}
    >
      {/* Status indicator */}
      <div
        className={cn(
          "flex h-6 w-6 shrink-0 items-center justify-center rounded-full",
          installed ? "bg-green-500/15" : "bg-white/5",
        )}
      >
        {installed ? (
          <Check className="h-3 w-3 text-green-400" />
        ) : (
          <X className="h-3 w-3 text-text-muted" />
        )}
      </div>

      {/* Font info */}
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs font-medium text-text-primary">{font.name}</span>
          {font.bundled && (
            <span className="rounded bg-green-500/15 px-1 py-0.5 text-[7px] font-medium text-green-400">
              Included
            </span>
          )}
          {font.nerdFont && (
            <span className="rounded bg-purple-500/15 px-1 py-0.5 text-[7px] font-medium text-purple-400">
              Nerd Font
            </span>
          )}
          {isActive && (
            <span className="rounded bg-accent/15 px-1 py-0.5 text-[7px] font-medium text-accent">
              active
            </span>
          )}
        </div>
        <p className="truncate text-[9px] text-text-muted">{font.description}</p>
        {/* Per-card preview — rendered in the card's OWN font so you can
            see exactly how icons/ligatures look before selecting it */}
        {installed && (
          <p
            className="mt-1 truncate text-[11px] text-text-secondary"
            style={{ fontFamily: `"${font.family}", monospace` }}
          >
            {font.nerdFont ? nerdPreview : plainPreview}
          </p>
        )}
      </div>

      {/* Actions */}
      <div className="flex items-center gap-1">
        {installed ? (
          <button
            type="button"
            onClick={() => (isActive ? onDeselect(font.family) : onSelect(font.family))}
            className={cn(
              "rounded-md px-2 py-1 text-[9px] font-medium transition-all",
              isActive
                ? "bg-accent/15 text-accent hover:bg-accent/25"
                : "bg-white/5 text-text-muted hover:bg-white/10 hover:text-text-primary",
            )}
            title={isActive ? "Click to deselect" : "Click to use this font"}
          >
            {isActive ? "Remove" : "Use"}
          </button>
        ) : font.url ? (
          <a
            href={font.url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 rounded-md bg-white/5 px-2 py-1 text-[9px] font-medium text-text-muted hover:bg-white/10 hover:text-text-secondary"
            onClick={(e) => {
              e.preventDefault();
              window.open(font.url, "_blank");
            }}
          >
            <Download className="h-2.5 w-2.5" />
            Install
          </a>
        ) : null}
      </div>
    </div>
  );
}
