import { cn } from "@exegol/ui";
import type { CSSProperties } from "react";

interface SpinnerPreset {
  frames: string[];
  interval: number;
  color: string;
}

const SPINNER_PRESETS: SpinnerPreset[] = [
  // Braille wave
  { frames: ["⣾", "⣷", "⣯", "⣟", "⡿", "⢿", "⣻", "⣽"], interval: 80, color: "text-accent" },
  // Braille dots orbit
  {
    frames: ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"],
    interval: 80,
    color: "text-purple-400",
  },
  // Moon phases
  { frames: ["🌑", "🌒", "🌓", "🌔", "🌕", "🌖", "🌗", "🌘"], interval: 150, color: "" },
  // Bouncing ball
  { frames: ["⠁", "⠂", "⠄", "⡀", "⢀", "⠠", "⠐", "⠈"], interval: 100, color: "text-green-400" },
  // Growing bar
  {
    frames: ["▏", "▎", "▍", "▌", "▋", "▊", "▉", "█", "▉", "▊", "▋", "▌", "▍", "▎", "▏"],
    interval: 60,
    color: "text-cyan-400",
  },
  // Arrows dance
  { frames: ["←", "↖", "↑", "↗", "→", "↘", "↓", "↙"], interval: 100, color: "text-amber-400" },
  // DNA helix
  { frames: ["╫", "╪", "╫", "╬", "╪", "╫"], interval: 120, color: "text-pink-400" },
  // Heartbeat
  { frames: ["♡", "♥", "♡", "♡"], interval: 200, color: "text-red-400" },
  // Stars twinkle
  { frames: ["✦", "✧", "✦", "⊹", "✧", "⊹"], interval: 180, color: "text-yellow-400" },
  // Blocks build
  { frames: ["░", "▒", "▓", "█", "▓", "▒", "░"], interval: 100, color: "text-blue-400" },
];

/**
 * A busy agent's spinner, the same one for that agent everywhere (hash of its id).
 * Pure CSS: the frames sit in a strip that steps sideways. It was a setInterval
 * re-rendering React every 60-200ms per busy agent, forever.
 */
export function AgentSpinner({ agentId, className }: { agentId: string; className?: string }) {
  let hash = 0;
  for (let i = 0; i < agentId.length; i++) hash = (hash * 31 + agentId.charCodeAt(i)) | 0;
  const preset = SPINNER_PRESETS[Math.abs(hash) % SPINNER_PRESETS.length];
  if (!preset) return null;
  const style = {
    "--frames": preset.frames.length,
    animationDuration: `${preset.frames.length * preset.interval}ms`,
  } as CSSProperties;
  return (
    <span
      className={cn(
        "inline-block w-4 overflow-hidden text-center align-bottom font-mono",
        preset.color,
        className,
      )}
    >
      <span className="glyph-spin flex" style={style}>
        {preset.frames.map((f, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: frames repeat, their order is fixed
          <span key={i} className="w-4 shrink-0">
            {f}
          </span>
        ))}
      </span>
    </span>
  );
}
