import { cn } from "@exegol/ui";
import { useThemeValue } from "../../hooks/use-theme";

// ─── SVG URL resolution (Vite-compatible for Electron) ──────────────────────

function iconUrl(name: string): string {
  return new URL(`../../assets/icons/${name}`, import.meta.url).href;
}

// ─── Icon registry ──────────────────────────────────────────────────────────

interface IconEntry {
  light: string;
  dark: string;
}

type IconDef = string | { light: string; dark: string };

function single(name: string): string {
  return iconUrl(name);
}

function pair(lightName: string, darkName: string): IconEntry {
  return { light: iconUrl(lightName), dark: iconUrl(darkName) };
}

/** Map of provider/tool IDs to their SVG icon URLs (light and dark variants). */
const ICON_MAP: Record<string, IconDef> = {
  // Agent CLIs
  "claude-code": single("claude.svg"),
  claude: single("claude.svg"),
  codex: pair("openai-light.svg", "openai-dark.svg"),
  openai: pair("openai-light.svg", "openai-dark.svg"),
  gemini: single("gemini.svg"),
  aider: single("antigravity.svg"),
  goose: single("ghostty.svg"),
  opencode: pair("opencode-light.svg", "opencode-dark.svg"),
  windsurf: pair("windsurf-light.svg", "windsurf-dark.svg"),
  kilocode: pair("kilocode-light.svg", "kilocode-dark.svg"),
  ollama: pair("ollama-light.svg", "ollama-dark.svg"),

  // IDEs
  vscode: single("vscode.svg"),

  // Providers (for API key settings)
  anthropic: single("claude.svg"),
  google: single("gemini.svg"),

  // MCP
  mcp: pair("mcp-light.svg", "mcp-dark.svg"),

  // Routing
  openrouter: pair("openrouter-light.svg", "openrouter-dark.svg"),
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
