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
  /** A "cap" section the user resized: this height instead of the share */
  height?: number | null;
  children: React.ReactNode;
}

export function SidebarSection({
  title,
  icon: Icon,
  defaultOpen = true,
  count,
  action,
  size,
  height,
  children,
}: SidebarSectionProps) {
  const [open, setOpen] = useState(defaultOpen);

  // Each section scrolls on its own and its header stays put: one long scroll
  // pushed Projects (and its "+") out of view behind a long agent list
  return (
    <div
      style={open && size === "cap" && height ? { height } : undefined}
      className={cn("flex min-h-0 flex-col py-1", sectionSizing(open, size, height))}
    >
      <SectionHeader
        title={title}
        icon={Icon}
        count={count}
        action={action}
        open={open}
        onToggle={() => setOpen(!open)}
      />

      {/* Content — collapsible */}
      {/* No size: a bottom section; a % cap means nothing inside an auto-height footer */}
      {open && (
        <div
          className={cn("sidebar-scroll min-h-0 overflow-y-auto px-3 pt-1", !size && "max-h-56")}
        >
          {children}
        </div>
      )}
    </div>
  );
}

/** How an open section takes the sidebar's height; a closed one keeps just its header */
function sectionSizing(open: boolean, size: SidebarSectionProps["size"], height?: number | null) {
  if (!open || !size) return "shrink-0";
  if (size === "fill") return "flex-1";
  return height ? "max-h-[calc(100%-4rem)] shrink-0" : "max-h-[45%] shrink-0";
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
