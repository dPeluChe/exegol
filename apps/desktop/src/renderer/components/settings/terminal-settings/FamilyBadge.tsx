import { cn } from "@exegol/ui";
import { X } from "lucide-react";

export function FamilyBadge({
  family,
  isPrimary,
  onPromote,
  onRemove,
}: {
  family: string;
  isPrimary: boolean;
  /** Called when the user clicks the badge body — promotes this family to primary. */
  onPromote: () => void;
  /** Called when the user clicks the × button — removes this family from the chain. */
  onRemove: () => void;
}) {
  // "monospace" and generic keywords shouldn't be removable — they're CSS
  // fallbacks, not real font choices. We also rename "monospace" to
  // "System default" for clarity (it's what xterm falls back to when no
  // custom font is selected).
  const isGeneric = ["monospace", "sans-serif", "serif"].includes(family.toLowerCase());
  const displayName = family.toLowerCase() === "monospace" ? "System default" : family;

  const interactive = !isPrimary && !isGeneric;

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: ARIA button role applied; can't use real <button> because nested <button> for × is invalid HTML
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-medium transition-colors",
        isPrimary
          ? "border-accent/30 bg-accent/15 text-accent"
          : isGeneric
            ? "border-transparent bg-white/5 text-text-muted italic"
            : "cursor-pointer border-transparent bg-white/5 text-text-secondary hover:border-accent/20 hover:bg-accent/10 hover:text-accent",
      )}
      style={{ fontFamily: isGeneric ? undefined : `"${family}", monospace` }}
      title={
        isGeneric
          ? "System fallback (can't be removed or promoted)"
          : isPrimary
            ? "Primary font — used first. Click another badge to change."
            : "Click to promote as primary, or × to remove"
      }
      onClick={interactive ? onPromote : undefined}
      onKeyDown={
        interactive
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onPromote();
              }
            }
          : undefined
      }
      role={interactive ? "button" : undefined}
      tabIndex={interactive ? 0 : undefined}
    >
      {displayName}
      {!isGeneric && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          className="flex h-3 w-3 items-center justify-center rounded-full text-text-muted hover:bg-red-400/80 hover:text-white"
          title="Remove from chain"
        >
          <X className="h-2 w-2" />
        </button>
      )}
    </span>
  );
}
