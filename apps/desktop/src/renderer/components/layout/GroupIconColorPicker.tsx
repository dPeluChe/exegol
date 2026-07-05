import { cn } from "@exegol/ui";
import type { LucideIcon } from "lucide-react";
import {
  Archive,
  Boxes,
  Briefcase,
  Cloud,
  Code2,
  Folder,
  GitBranch,
  Globe,
  Layers,
  Rocket,
  Server,
  Sparkles,
} from "lucide-react";

export const GROUP_COLORS = [
  "#3B82F6", // blue
  "#10B981", // green
  "#F59E0B", // amber
  "#EF4444", // red
  "#8B5CF6", // violet
  "#EC4899", // pink
  "#06B6D4", // cyan
  "#6B7280", // gray
];

export const GROUP_ICONS: Record<string, LucideIcon> = {
  Folder,
  Layers,
  Boxes,
  Server,
  Cloud,
  Code2,
  GitBranch,
  Rocket,
  Briefcase,
  Archive,
  Globe,
  Sparkles,
};

export function resolveGroupIcon(icon: string | null): LucideIcon {
  return (icon && GROUP_ICONS[icon]) || Folder;
}

interface GroupIconColorPickerProps {
  color: string | null;
  icon: string | null;
  onChange: (color: string, icon: string) => void;
}

/** T146: color/icon picker for a project group — no shared picker exists, built here. */
export function GroupIconColorPicker({ color, icon, onChange }: GroupIconColorPickerProps) {
  const activeColor = color ?? GROUP_COLORS[0] ?? "#3B82F6";
  const activeIcon = icon ?? "Folder";

  return (
    <div className="space-y-2 p-2">
      <div className="flex flex-wrap gap-1.5">
        {GROUP_COLORS.map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => onChange(c, activeIcon)}
            className={cn(
              "h-5 w-5 rounded-full ring-offset-1 ring-offset-bg-secondary transition-transform hover:scale-110",
              activeColor === c && "ring-2 ring-white/80",
            )}
            style={{ backgroundColor: c }}
            title={c}
          />
        ))}
      </div>
      <div className="grid grid-cols-6 gap-1">
        {Object.entries(GROUP_ICONS).map(([name, Icon]) => (
          <button
            key={name}
            type="button"
            onClick={() => onChange(activeColor, name)}
            className={cn(
              "flex h-7 w-7 items-center justify-center rounded-md text-text-secondary transition-colors hover:bg-white/10",
              activeIcon === name && "bg-white/10 text-text-primary ring-1 ring-accent/50",
            )}
            title={name}
          >
            <Icon className="h-3.5 w-3.5" />
          </button>
        ))}
      </div>
    </div>
  );
}
