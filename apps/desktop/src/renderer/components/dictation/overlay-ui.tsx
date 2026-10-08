import { cn } from "@exegol/ui";
import type { MouseEvent, ReactNode } from "react";

/** Buttons keep the focus where it was: the text goes to the pane that had it */
export const keepFocus = (e: MouseEvent) => e.preventDefault();

const VARIANTS = {
  plain:
    "rounded-md px-2.5 py-1 text-xs font-medium text-text-secondary hover:bg-bg-tertiary hover:text-text-primary",
  primary: "rounded-md px-2.5 py-1 text-xs font-medium bg-accent text-white hover:bg-accent-hover",
  /** Keycaps plus a word: the recorder's Insert and Cancel */
  keys: "inline-flex min-h-6 shrink-0 items-center gap-1 rounded-md px-1 text-[10px] text-text-muted hover:bg-bg-tertiary hover:text-text-primary",
};

export function OverlayButton({
  variant = "plain",
  disabled,
  title,
  label,
  onClick,
  children,
}: {
  variant?: keyof typeof VARIANTS;
  disabled?: boolean;
  /** Tooltip; may hold key glyphs */
  title?: string;
  /** Accessible name in words, when the content is glyphs */
  label?: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      title={title}
      aria-label={label}
      onMouseDown={keepFocus}
      onClick={onClick}
      className={cn("transition-colors disabled:opacity-50", VARIANTS[variant])}
    >
      {children}
    </button>
  );
}
