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
    <div className="flex min-h-0 shrink-0 flex-col py-1">
      <SectionHeader
        title={title}
        icon={Icon}
        count={count}
        action={action}
        open={open}
        onToggle={() => setOpen(!open)}
      />

      {/* Content — collapsible */}
      {open && (
        <div className="sidebar-scroll max-h-56 min-h-0 overflow-y-auto px-3 pt-1">{children}</div>
      )}
    </div>
  );
}

/** The action is a sibling of the toggle so its buttons never nest */
function SectionHeader({
  title,
  icon: Icon,
  count,
  action,
  open,
  onToggle,
}: Pick<SidebarSectionProps, "title" | "icon" | "count" | "action"> & {
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="flex w-full shrink-0 items-stretch text-[10px] font-semibold uppercase tracking-wider text-text-muted transition-colors hover:text-text-secondary">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className={cn(
          "flex min-w-0 flex-1 cursor-pointer items-center gap-1 py-1 pl-3 text-left uppercase",
          !action && "pr-3",
        )}
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
      </button>
      {action && (
        <span className="flex shrink-0 items-center gap-0.5 py-1 pr-3 pl-1">{action}</span>
      )}
    </div>
  );
}
