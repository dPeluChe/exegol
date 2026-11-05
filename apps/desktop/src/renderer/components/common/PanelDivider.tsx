import { PanelResizeHandle } from "react-resizable-panels";

/** The draggable line between two side-by-side panels */
export function PanelDivider({ onDragging }: { onDragging?: (dragging: boolean) => void }) {
  return (
    <PanelResizeHandle onDragging={onDragging} className="group relative w-1.5 shrink-0">
      <div className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-border transition-[width,background-color] group-hover:w-[3px] group-hover:bg-accent/60 group-data-[resize-handle-active]:w-[3px] group-data-[resize-handle-active]:bg-accent" />
    </PanelResizeHandle>
  );
}
