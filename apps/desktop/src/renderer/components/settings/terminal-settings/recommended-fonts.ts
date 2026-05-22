// ─── Recommended fonts with install URLs ────────────────────────────────────
//
// Nerd Fonts are listed first and labeled so users with oh-my-zsh /
// powerlevel10k themes get their icons rendering in xterm.js. Family
// names must match EXACTLY what the OS reports (check with
// `system_profiler SPFontsDataType` on macOS or `fc-list` on Linux).
//
// Mono variants are preferred over proportional for terminals because
// xterm.js assumes fixed-width cells.

export interface RecommendedFont {
  name: string;
  family: string;
  description: string;
  url: string;
  nerdFont: boolean;
  /** Bundled inside the app — no install required. Always available. */
  bundled?: boolean;
}

export const RECOMMENDED_FONTS: RecommendedFont[] = [
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
export function isFontInstalled(family: string): boolean {
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

// Normalize a family name for comparison: strip surrounding quotes,
// trim whitespace, lowercase (CSS font-family is case-insensitive).
// This lets us compare "MesloLGS NF", "meslolgs nf", and MesloLGS NF
// as the same family regardless of how they're stored in the chain.
export const normalizeFamily = (s: string): string =>
  s
    .trim()
    .replace(/^["']|["']$/g, "")
    .toLowerCase();

// Sample string that exercises the full Nerd Font glyph spectrum +
// common powerline separators + dev symbols + ligatures. If a card
// renders these as boxes/tofu, the font isn't actually loaded.
export const NERD_PREVIEW = "\ue7c5 \ue7a8 \uf013 \uf1d3 \ue0b0 \ue0b2  == => !=";
export const PLAIN_PREVIEW = "$ echo hello   == => != <$>";
