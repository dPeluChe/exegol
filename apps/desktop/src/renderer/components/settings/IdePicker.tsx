import type { DetectedIde, IdeType } from "@exegol/shared";
import { cn } from "@exegol/ui";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, RefreshCw } from "lucide-react";
import { useIdes } from "../../hooks/use-trpc";
import { openInBrowser } from "../../lib/open-in-browser";
import { trpcInvoke } from "../../lib/trpc-client";
import { AgentIcon } from "../common/AgentIcon";

interface Option {
  value: IdeType | null;
  label: string;
  sub?: string;
  icon: string;
  glyph: string;
  color: string;
}

const CUSTOM: Option = {
  value: "custom",
  label: "Custom",
  icon: "custom",
  glyph: "⚙",
  color: "#6B7280",
};

function subtitle(ide: DetectedIde): string | undefined {
  if (ide.formerly) return `formerly ${ide.formerly}`;
  return ide.terminal ? "in a terminal tab" : undefined;
}

const toOption = (ide: DetectedIde): Option => ({
  value: ide.id,
  label: ide.label,
  sub: subtitle(ide),
  icon: ide.icon,
  glyph: ide.glyph,
  color: ide.color,
});

/** Installed IDEs first and selectable; the rest greyed with a link to their download page.
 *  `follow` adds a first option that clears the choice (Edit project: same as Settings) */
export function IdePicker({
  value,
  onChange,
  follow,
  compact,
}: {
  value: string | null;
  onChange: (ide: IdeType | null) => void;
  follow?: { label: string; sub: string };
  compact?: boolean;
}) {
  const { data: ides = [], isLoading } = useIdes();
  const queryClient = useQueryClient();
  const rescan = useMutation({
    mutationFn: () => trpcInvoke<DetectedIde[]>("ide.list", { fresh: true }),
    onSuccess: (list) => queryClient.setQueryData(["ide", "list"], list),
  });
  const installed = ides.filter((i) => i.installed);
  const missing = ides.filter((i) => !i.installed);
  const options: Option[] = [
    ...(follow ? [{ value: null, ...follow, icon: "", glyph: "↺", color: "#6B7280" }] : []),
    ...installed.map(toOption),
    ...(compact ? [] : [CUSTOM]),
  ];
  const iconSize = compact ? 18 : 28;
  const grid = compact ? "grid-cols-3" : "grid-cols-3 xl:grid-cols-6";
  const card = compact ? "gap-1 rounded-lg p-2" : "gap-1.5 rounded-xl p-3";

  return (
    <div>
      {isLoading ? (
        <div className="flex items-center gap-2 py-2 text-[11px] text-text-muted">
          <Loader2 className="h-3 w-3 animate-spin" /> Looking for installed IDEs...
        </div>
      ) : (
        <div className={cn("grid gap-2", grid)}>
          {options.map((opt) => {
            const isActive = value === opt.value;
            return (
              <button
                key={opt.value ?? "follow"}
                type="button"
                onClick={() => onChange(opt.value)}
                className={cn(
                  "flex flex-col items-center border transition-all",
                  card,
                  isActive
                    ? "border-accent bg-accent/10"
                    : "border-border bg-bg-secondary hover:border-accent/30 hover:bg-white/5",
                )}
              >
                <AgentIcon
                  provider={opt.icon || "follow"}
                  size={iconSize}
                  fallback={opt.glyph}
                  fallbackColor={opt.color}
                />
                <span
                  className={cn(
                    "text-center text-[10px] font-medium leading-tight",
                    isActive ? "text-accent" : "text-text-secondary",
                  )}
                >
                  {opt.label}
                </span>
                {opt.sub && (
                  <span className="text-center text-[9px] leading-tight text-text-muted">
                    {opt.sub}
                  </span>
                )}
              </button>
            );
          })}
          {missing.map((ide) => (
            <div
              key={ide.id}
              title={`${ide.label} is not installed`}
              className={cn(
                "flex flex-col items-center border border-dashed opacity-60",
                value === ide.id ? "border-accent" : "border-border",
                card,
              )}
            >
              <span className="grayscale">
                <AgentIcon
                  provider={ide.icon}
                  size={iconSize}
                  fallback={ide.glyph}
                  fallbackColor={ide.color}
                />
              </span>
              <span className="text-center text-[10px] font-medium leading-tight text-text-muted">
                {ide.label}
              </span>
              <button
                type="button"
                onClick={() => openInBrowser(ide.download)}
                className="text-[9px] text-accent hover:underline"
              >
                Get it
              </button>
            </div>
          ))}
        </div>
      )}
      <button
        type="button"
        onClick={() => rescan.mutate()}
        disabled={rescan.isPending}
        className="mt-1.5 flex items-center gap-1 text-[10px] text-text-muted hover:text-text-primary"
      >
        <RefreshCw className={cn("h-2.5 w-2.5", rescan.isPending && "animate-spin")} />
        Look again for installed IDEs
      </button>
    </div>
  );
}
