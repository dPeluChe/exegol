import { cn } from "@exegol/ui";
import type { ReactNode } from "react";

/** One key of a shortcut, drawn as a keycap */
export function Kbd({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <kbd
      className={cn(
        "inline-flex h-6 min-w-6 items-center justify-center rounded-md border border-border/80 bg-bg-tertiary px-1.5 text-[10px] font-medium text-text-secondary shadow-[0_1px_0_1px_rgba(0,0,0,0.3)]",
        className,
      )}
    >
      {children}
    </kbd>
  );
}
