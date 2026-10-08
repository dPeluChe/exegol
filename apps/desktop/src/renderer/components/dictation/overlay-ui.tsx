import { cn } from "@exegol/ui";
import type { MouseEvent, ReactNode } from "react";

/** Buttons keep the focus where it was: the text goes to the pane that had it */
export const keepFocus = (e: MouseEvent) => e.preventDefault();

export function OverlayButton({
  primary,
  disabled,
  onClick,
  children,
}: {
  primary?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onMouseDown={keepFocus}
      onClick={onClick}
      className={cn(
        "rounded-md px-2.5 py-1 text-xs font-medium transition-colors disabled:opacity-50",
        primary
          ? "bg-accent text-white hover:bg-accent-hover"
          : "text-text-secondary hover:bg-bg-tertiary hover:text-text-primary",
      )}
    >
      {children}
    </button>
  );
}
