import { cn } from "@exegol/ui";
import { Check, Download, X } from "lucide-react";
import type { RecommendedFont } from "./recommended-fonts";

interface FontCardProps {
  font: RecommendedFont;
  installed: boolean;
  isActive: boolean;
  nerdPreview: string;
  plainPreview: string;
  onSelect: (family: string) => void;
  onDeselect: (family: string) => void;
}

export function FontCard({
  font,
  installed,
  isActive,
  nerdPreview,
  plainPreview,
  onSelect,
  onDeselect,
}: FontCardProps) {
  return (
    <div
      className={cn(
        "flex items-center gap-3 rounded-lg border bg-bg-secondary p-2.5",
        isActive ? "border-accent/50" : "border-border",
      )}
    >
      {/* Status indicator */}
      <div
        className={cn(
          "flex h-6 w-6 shrink-0 items-center justify-center rounded-full",
          installed ? "bg-green-500/15" : "bg-white/5",
        )}
      >
        {installed ? (
          <Check className="h-3 w-3 text-green-400" />
        ) : (
          <X className="h-3 w-3 text-text-muted" />
        )}
      </div>

      {/* Font info */}
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs font-medium text-text-primary">{font.name}</span>
          {font.bundled && (
            <span className="rounded bg-green-500/15 px-1 py-0.5 text-[7px] font-medium text-green-400">
              Included
            </span>
          )}
          {font.nerdFont && (
            <span className="rounded bg-purple-500/15 px-1 py-0.5 text-[7px] font-medium text-purple-400">
              Nerd Font
            </span>
          )}
          {isActive && (
            <span className="rounded bg-accent/15 px-1 py-0.5 text-[7px] font-medium text-accent">
              active
            </span>
          )}
        </div>
        <p className="truncate text-[9px] text-text-muted">{font.description}</p>
        {/* Per-card preview — rendered in the card's OWN font so you can
            see exactly how icons/ligatures look before selecting it */}
        {installed && (
          <p
            className="mt-1 truncate text-[11px] text-text-secondary"
            style={{ fontFamily: `"${font.family}", monospace` }}
          >
            {font.nerdFont ? nerdPreview : plainPreview}
          </p>
        )}
      </div>

      {/* Actions — Remove takes priority over Install, so fonts that are
          in the chain but not installed (e.g., SF Mono on a machine
          that doesn't have it) can still be removed from the card.
          Previously only installed fonts got a button, leaving the user
          stuck scrolling up to the top-card badge × to remove them. */}
      <div className="flex items-center gap-1">
        {isActive ? (
          <button
            type="button"
            onClick={() => onDeselect(font.family)}
            className="rounded-md bg-accent/15 px-2 py-1 text-[9px] font-medium text-accent transition-all hover:bg-accent/25"
            title="Click to remove from the font chain"
          >
            Remove
          </button>
        ) : installed ? (
          <button
            type="button"
            onClick={() => onSelect(font.family)}
            className="rounded-md bg-white/5 px-2 py-1 text-[9px] font-medium text-text-muted transition-all hover:bg-white/10 hover:text-text-primary"
            title="Click to use this font as primary"
          >
            Use
          </button>
        ) : font.url ? (
          <a
            href={font.url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 rounded-md bg-white/5 px-2 py-1 text-[9px] font-medium text-text-muted hover:bg-white/10 hover:text-text-secondary"
            onClick={(e) => {
              e.preventDefault();
              window.open(font.url, "_blank");
            }}
          >
            <Download className="h-2.5 w-2.5" />
            Install
          </a>
        ) : null}
      </div>
    </div>
  );
}
