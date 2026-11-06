import { cn } from "@exegol/ui";
import type { ReactNode } from "react";

export const SIZE_BUTTON =
  "rounded px-1 py-0.5 text-[10px] text-text-muted hover:bg-white/10 hover:text-text-primary";

/** A-/A+ around the size in use; `size` undefined hides the number */
export function FontStepper({
  size,
  accent,
  onStep,
  children,
}: {
  size: number | undefined;
  accent?: boolean;
  onStep: (delta: number) => void;
  children?: ReactNode;
}) {
  return (
    <div className="flex shrink-0 items-center gap-0.5">
      <button type="button" onClick={() => onStep(-1)} className={SIZE_BUTTON} title="Smaller text">
        A−
      </button>
      {size !== undefined && (
        <span
          className={cn(
            "w-5 text-center text-[10px] tabular-nums",
            accent ? "text-accent" : "text-text-muted",
          )}
        >
          {size}
        </span>
      )}
      <button type="button" onClick={() => onStep(1)} className={SIZE_BUTTON} title="Larger text">
        A+
      </button>
      {children}
    </div>
  );
}
