import type { AgentAccessMode } from "@exegol/shared";
import { cn } from "@exegol/ui";
import { Eye, Map as MapIcon } from "lucide-react";

const ACCESS_MODES: Partial<
  Record<AgentAccessMode, { label: string; icon: typeof Eye; text: string; bg: string }>
> = {
  read: { label: "read-only", icon: Eye, text: "text-blue-400", bg: "bg-blue-500/20" },
  plan: { label: "plan-only", icon: MapIcon, text: "text-purple-400", bg: "bg-purple-500/20" },
};

/** T58: read/plan agents get a badge; write (the default) gets none.
 *  `pill` sits in the terminal toolbar, `inline` in a text row like the dashboard card's. */
export function AccessModeBadge({
  mode,
  variant = "pill",
}: {
  mode: AgentAccessMode | null | undefined;
  variant?: "pill" | "inline";
}) {
  const config = mode ? ACCESS_MODES[mode] : undefined;
  if (!config) return null;
  const title = `Agent running in ${config.label} mode`;
  if (variant === "inline") {
    const Icon = config.icon;
    return (
      <span className={cn("flex items-center gap-0.5", config.text)} title={title}>
        <Icon className="h-2.5 w-2.5" />
        {config.label}
      </span>
    );
  }
  return (
    <span
      className={cn(
        "rounded px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide",
        config.bg,
        config.text,
      )}
      title={title}
    >
      {config.label}
    </span>
  );
}
