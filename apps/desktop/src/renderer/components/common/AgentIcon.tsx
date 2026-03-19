import { cn } from "@exegol/ui";
import { useThemeValue } from "../../hooks/use-theme";

// ─── Load all SVG icons via Vite glob (static analysis at build time) ───────

const iconModules = import.meta.glob("../../assets/icons/*.{svg,png}", {
  eager: true,
  query: "?url",
  import: "default",
}) as Record<string, string>;

/** Resolve a filename like "claude.svg" to its Vite-processed URL. */
function iconUrl(name: string): string | undefined {
  // Glob keys look like "../../assets/icons/claude.svg"
  const key = `../../assets/icons/${name}`;
  return iconModules[key];
}

// ─── Icon registry ──────────────────────────────────────────────────────────

type IconDef = { single: string } | { light: string; dark: string };

function buildMap(): Record<string, IconDef> {
  const map: Record<string, IconDef> = {};

  const s = (name: string): IconDef | null => {
    const url = iconUrl(name);
    return url ? { single: url } : null;
  };

  const p = (lightName: string, darkName: string): IconDef | null => {
    const light = iconUrl(lightName);
    const dark = iconUrl(darkName);
    return light && dark ? { light, dark } : null;
  };

  const set = (id: string, def: IconDef | null) => {
    if (def) map[id] = def;
  };

  // Agent CLIs
  set("claude-code", s("claude.svg"));
  set("claude", s("claude.svg"));
  set("codex", p("openai-light.svg", "openai-dark.svg"));
  set("openai", p("openai-light.svg", "openai-dark.svg"));
  set("gemini", s("gemini.svg"));
  set("crush", s("crush.png"));
  // aider, goose: no official SVG yet — use text fallback
  set("opencode", p("opencode-light.svg", "opencode-dark.svg"));
  set("windsurf", p("windsurf-light.svg", "windsurf-dark.svg"));
  set("kilocode", p("kilocode-light.svg", "kilocode-dark.svg"));
  set("ollama", p("ollama-light.svg", "ollama-dark.svg"));

  // IDEs
  set("vscode", s("vscode.svg"));
  set("zed", p("zed-light.svg", "zed-dark.svg"));
  // cursor: no SVG available yet — uses text fallback

  // Providers
  set("anthropic", s("claude.svg"));
  set("google", s("gemini.svg"));
  set("copilot", p("copilot-light.svg", "copilot-dark.svg"));

  // Git / GitHub
  set("git", s("git.svg"));
  set("github", p("github-light.svg", "github-dark.svg"));

  // MCP
  set("mcp", p("mcp-light.svg", "mcp-dark.svg"));

  // Routing
  set("openrouter", p("openrouter-light.svg", "openrouter-dark.svg"));

  return map;
}

const ICON_MAP = buildMap();

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
    const src = "single" in entry ? entry.single : isDark ? entry.dark : entry.light;
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
