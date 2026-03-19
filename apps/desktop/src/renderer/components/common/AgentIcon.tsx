import { cn } from "@exegol/ui";
import { useThemeValue } from "../../hooks/use-theme";

// ─── SVG imports (bundled locally, no network) ──────────────────────────────

import antigravity from "../../assets/icons/antigravity.svg";
import claude from "../../assets/icons/claude.svg";
import gemini from "../../assets/icons/gemini.svg";
import ghostty from "../../assets/icons/ghostty.svg";
// Light/dark pairs
import kilocodeDark from "../../assets/icons/kilocode-dark.svg";
import kilocodeLight from "../../assets/icons/kilocode-light.svg";
import mcpDark from "../../assets/icons/mcp-dark.svg";
import mcpLight from "../../assets/icons/mcp-light.svg";
import ollamaDark from "../../assets/icons/ollama-dark.svg";
import ollamaLight from "../../assets/icons/ollama-light.svg";
import openaiDark from "../../assets/icons/openai-dark.svg";
import openaiLight from "../../assets/icons/openai-light.svg";
import opencodeDark from "../../assets/icons/opencode-dark.svg";
import opencodeLight from "../../assets/icons/opencode-light.svg";
import openrouterDark from "../../assets/icons/openrouter-dark.svg";
import openrouterLight from "../../assets/icons/openrouter-light.svg";
import vscode from "../../assets/icons/vscode.svg";
import windsurfDark from "../../assets/icons/windsurf-dark.svg";
import windsurfLight from "../../assets/icons/windsurf-light.svg";

// ─── Icon registry ──────────────────────────────────────────────────────────

interface IconEntry {
  light: string;
  dark: string;
}

/** Map of provider/tool IDs to their SVG icon paths (light and dark variants). */
const ICON_MAP: Record<string, IconEntry | string> = {
  // Agent CLIs
  "claude-code": claude,
  claude: claude,
  codex: { light: openaiLight, dark: openaiDark },
  openai: { light: openaiLight, dark: openaiDark },
  gemini: gemini,
  aider: antigravity, // Fallback — no official SVG available
  goose: ghostty, // Fallback — no official SVG available
  opencode: { light: opencodeLight, dark: opencodeDark },
  windsurf: { light: windsurfLight, dark: windsurfDark },
  kilocode: { light: kilocodeLight, dark: kilocodeDark },
  ollama: { light: ollamaLight, dark: ollamaDark },

  // IDEs
  vscode: vscode,
  cursor: { light: openaiLight, dark: openaiDark }, // TODO: add cursor.svg when available
  zed: ghostty, // TODO: add zed.svg when available

  // Providers (for API key settings)
  anthropic: claude,
  google: gemini,

  // MCP
  mcp: { light: mcpLight, dark: mcpDark },

  // Routing
  openrouter: { light: openrouterLight, dark: openrouterDark },
};

// ─── Component ──────────────────────────────────────────────────────────────

interface AgentIconProps {
  /** Provider or tool ID (e.g. "claude-code", "codex", "gemini", "vscode") */
  provider: string;
  /** Icon size in pixels (default: 20) */
  size?: number;
  /** Additional CSS classes */
  className?: string;
  /** Fallback text shown when no icon found (default: first 2 chars of provider) */
  fallback?: string;
  /** Fallback background color */
  fallbackColor?: string;
}

export function AgentIcon({
  provider,
  size = 20,
  className,
  fallback,
  fallbackColor = "#6B7280",
}: AgentIconProps) {
  const theme = useThemeValue();
  const isDark = theme === "dark";

  const entry = ICON_MAP[provider.toLowerCase()];

  if (entry) {
    const src = typeof entry === "string" ? entry : isDark ? entry.dark : entry.light;
    return (
      <img
        src={src}
        alt={provider}
        width={size}
        height={size}
        className={cn("shrink-0 object-contain", className)}
        draggable={false}
      />
    );
  }

  // Fallback: colored square with initials
  const initials =
    fallback ??
    provider
      .replace(/-/g, " ")
      .split(" ")
      .map((w) => w[0])
      .join("")
      .toUpperCase()
      .slice(0, 2);

  return (
    <span
      className={cn(
        "flex shrink-0 items-center justify-center rounded font-bold text-white",
        className,
      )}
      style={{
        width: size,
        height: size,
        fontSize: size * 0.4,
        background: fallbackColor,
      }}
    >
      {initials}
    </span>
  );
}
