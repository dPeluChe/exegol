import { cn } from "@exegol/ui";

/** Small pill toggle used by filter/group switchers (Doctor, sessions dashboard). */
export function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-full px-2 py-0.5 text-[10px] transition-colors",
        active
          ? "bg-white/10 text-text-primary"
          : "text-text-muted hover:bg-white/5 hover:text-text-secondary",
      )}
    >
      {children}
    </button>
  );
}
