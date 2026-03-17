import { cn } from "@exegol/ui";
import { ChevronDown, ChevronRight, type LucideIcon } from "lucide-react";
import { useState } from "react";

interface SidebarSectionProps {
  title: string;
  icon?: LucideIcon;
  defaultOpen?: boolean;
  count?: number;
  action?: React.ReactNode;
  children: React.ReactNode;
}

function ActionWrapper({ children }: { children: React.ReactNode }) {
  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: stopPropagation wrapper, not interactive itself
    // biome-ignore lint/a11y/noStaticElementInteractions: stopPropagation wrapper
    <span onClick={(e) => e.stopPropagation()} className="shrink-0">
      {children}
    </span>
  );
}

export function SidebarSection({
  title,
  icon: Icon,
  defaultOpen = true,
  count,
  action,
  children,
}: SidebarSectionProps) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="py-1">
      {/* Header — clickable to toggle */}
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-1 px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-text-muted transition-colors hover:text-text-secondary"
      >
        {open ? (
          <ChevronDown className="h-2.5 w-2.5 shrink-0" />
        ) : (
          <ChevronRight className="h-2.5 w-2.5 shrink-0" />
        )}
        {Icon && <Icon className="h-3 w-3 shrink-0" />}
        <span className="flex-1 text-left">{title}</span>
        {count !== undefined && count > 0 && (
          <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-white/10 px-1 text-[9px] font-normal text-text-muted">
            {count}
          </span>
        )}
        {action && <ActionWrapper>{action}</ActionWrapper>}
      </button>

      {/* Content — collapsible */}
      {open && <div className={cn("px-3 pt-1", !open && "hidden")}>{children}</div>}
    </div>
  );
}
