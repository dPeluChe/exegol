import { cn } from "@exegol/ui";
import { ChevronDown, ChevronRight, type LucideIcon } from "lucide-react";
import { useState } from "react";

interface SidebarSectionProps {
  title: string;
  icon?: LucideIcon;
  defaultOpen?: boolean;
  count?: number;
  action?: React.ReactNode;
  /** Sizing while open: "cap" = up to a share of the sidebar, "fill" = the rest; both scroll inside */
  size?: "cap" | "fill";
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
  size,
  children,
}: SidebarSectionProps) {
  const [open, setOpen] = useState(defaultOpen);

  // Each section scrolls on its own and its header stays put: one long scroll
  // pushed Projects (and its "+") out of view behind a long agent list
  return (
    <div
      className={cn(
        "flex min-h-0 flex-col py-1",
        !open && "shrink-0",
        open && size === "cap" && "max-h-[45%] shrink-0",
        open && size === "fill" && "flex-1",
        open && !size && "max-h-[30%] shrink-0",
      )}
    >
      {/* Header — div instead of button because action slot contains buttons (no nesting) */}
      {/* biome-ignore lint/a11y/useSemanticElements: button nesting — action slot contains buttons */}
      <div
        role="button"
        tabIndex={0}
        onClick={() => setOpen(!open)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") setOpen(!open);
        }}
        className="flex w-full shrink-0 cursor-pointer items-center gap-1 px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-text-muted transition-colors hover:text-text-secondary"
      >
        {open ? (
          <ChevronDown className="h-2.5 w-2.5 shrink-0" />
        ) : (
          <ChevronRight className="h-2.5 w-2.5 shrink-0" />
        )}
        {Icon && <Icon className="h-3 w-3 shrink-0" />}
        <span className="min-w-0 flex-1 truncate text-left">{title}</span>
        {count !== undefined && count > 0 && (
          <span className="flex h-4 min-w-4 shrink-0 items-center justify-center rounded-full bg-white/10 px-1 text-[9px] font-normal text-text-muted">
            {count}
          </span>
        )}
        {action && <ActionWrapper>{action}</ActionWrapper>}
      </div>

      {/* Content — collapsible */}
      {open && <div className="min-h-0 overflow-y-auto px-3 pt-1">{children}</div>}
    </div>
  );
}
