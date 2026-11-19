import type { ViewEntry } from "@exegol/shared";
import { Button } from "@exegol/ui";
import { X } from "lucide-react";
import { useRef, useState } from "react";
import { useMountEffect } from "../../hooks/use-mount-effect";
import { useViewThumb } from "../../hooks/use-views";

/** A view's capture at the page's own size, over the canvas: fitted to the pane's width, or at
 *  100% with both scrolls. Esc or the button closes it */
export function ViewLightbox({
  projectId,
  view,
  onClose,
}: {
  projectId: string;
  view: ViewEntry;
  onClose: () => void;
}) {
  const [actual, setActual] = useState(false);
  const image = useViewThumb(projectId, view.path, view.shot, true);
  const frame = useRef<HTMLDivElement>(null);
  // Focused, so Esc is its own: a listener on the window would take Esc from every other pane
  useMountEffect(() => frame.current?.focus());
  return (
    <div
      ref={frame}
      role="dialog"
      aria-label={`Capture of ${view.path}`}
      tabIndex={-1}
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.stopPropagation();
        onClose();
      }}
      className="absolute inset-0 z-20 flex flex-col bg-bg-primary outline-none"
    >
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-border px-3">
        <span className="min-w-0 flex-1 truncate font-mono text-xs text-text-primary">
          {view.path}
        </span>
        <Button size="sm" variant="outline" onClick={() => setActual((on) => !on)}>
          {actual ? "Fit width" : "100%"}
        </Button>
        <button
          type="button"
          title="Close (Esc)"
          className="rounded p-1 text-text-muted hover:bg-bg-tertiary"
          onClick={onClose}
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {image.data ? (
          <img
            src={image.data}
            alt={`Capture of ${view.path}`}
            draggable={false}
            className={actual ? "max-w-none" : "w-full"}
          />
        ) : (
          <p className="p-4 text-xs text-text-muted">
            {image.isLoading ? "Loading the capture" : "This view has no capture"}
          </p>
        )}
      </div>
    </div>
  );
}
