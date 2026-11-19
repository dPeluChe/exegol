import { layoutViews, type ViewEntry } from "@exegol/shared";
import { Maximize, Minus, Plus } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { useLatest } from "../../hooks/use-latest";
import { useMountEffect } from "../../hooks/use-mount-effect";
import {
  CARD_WIDTH,
  type Camera,
  cardHeight,
  fitCamera,
  linkCurve,
  zoomAt,
} from "../../lib/views-canvas";
import { ViewCard } from "./ViewCard";

const LAYOUT = { cardWidth: CARD_WIDTH, gapX: 28, gapY: 56, perRow: 6 };

/** The tree of views on a surface that pans (drag, wheel) and zooms (pinch, Ctrl or Cmd + wheel) */
export function ViewsCanvas({
  projectId,
  views,
  selected,
  onSelect,
}: {
  projectId: string;
  views: ViewEntry[];
  selected: string | null;
  onSelect: (path: string | null) => void;
}) {
  const frame = useRef<HTMLDivElement>(null);
  const [camera, setCamera] = useState<Camera | null>(null);
  const [size, setSize] = useState({ width: 800, height: 600 });
  const drag = useRef<{ x: number; y: number; moved: boolean } | null>(null);

  const byPath = useMemo(() => new Map(views.map((v) => [v.path, v])), [views]);
  const layout = useMemo(
    () =>
      layoutViews(
        views.map((v) => v.path),
        { ...LAYOUT, cardHeight: (path) => cardHeight(byPath.get(path)) },
      ),
    [views, byPath],
  );
  const boxes = useMemo(() => new Map(layout.boxes.map((b) => [b.path, b])), [layout]);

  // Until the person moves it, the camera follows the tree as it grows
  const cam = camera ?? fitCamera(layout, size);
  const latest = useLatest({ layout, size });

  useMountEffect(() => {
    const el = frame.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setSize({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(el);
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      setCamera((prev) => {
        const from = prev ?? fitCamera(latest.current.layout, latest.current.size);
        if (e.ctrlKey || e.metaKey) {
          return zoomAt(
            from,
            e.clientX - rect.left,
            e.clientY - rect.top,
            Math.exp(-e.deltaY * 0.01),
          );
        }
        return { ...from, x: from.x - e.deltaX, y: from.y - e.deltaY };
      });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      observer.disconnect();
      el.removeEventListener("wheel", onWheel);
    };
  });

  const zoomBy = (factor: number) =>
    setCamera(zoomAt(cam, size.width / 2, size.height / 2, factor));

  const picked = selected ? byPath.get(selected) : undefined;
  const from = selected ? boxes.get(selected) : undefined;
  const linkLines = (picked?.links ?? []).flatMap((link) => {
    const to = boxes.get(link.to);
    return from && to && link.to !== selected ? [{ ...link, d: linkCurve(from, to) }] : [];
  });
  const linkedPaths = new Set(linkLines.map((l) => l.to));

  return (
    <div
      ref={frame}
      className="relative min-h-0 flex-1 cursor-grab overflow-hidden bg-bg-primary active:cursor-grabbing"
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        drag.current = { x: e.clientX, y: e.clientY, moved: false };
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (!d || e.buttons !== 1) return;
        const dx = e.clientX - d.x;
        const dy = e.clientY - d.y;
        if (!d.moved && Math.abs(dx) + Math.abs(dy) < 4) return;
        if (!d.moved) e.currentTarget.setPointerCapture(e.pointerId);
        drag.current = { x: e.clientX, y: e.clientY, moved: true };
        setCamera({ ...cam, x: cam.x + dx, y: cam.y + dy });
      }}
      onPointerUp={(e) => {
        const d = drag.current;
        drag.current = null;
        if (d && !d.moved && !(e.target as HTMLElement).closest("[data-view-card]")) onSelect(null);
      }}
      onClickCapture={(e) => {
        // A drag that ends over a card is not a click on it
        if (drag.current?.moved) e.stopPropagation();
      }}
    >
      <div
        className="absolute left-0 top-0 origin-top-left"
        style={{
          width: layout.width,
          height: layout.height,
          transform: `translate(${cam.x}px, ${cam.y}px) scale(${cam.k})`,
        }}
      >
        <svg
          className="pointer-events-none absolute left-0 top-0 overflow-visible"
          width={layout.width}
          height={layout.height}
          aria-hidden="true"
        >
          {layout.lines.map((line) => (
            <path
              key={line.to}
              d={line.d}
              fill="none"
              stroke="var(--border)"
              strokeWidth={1.5 / cam.k}
            />
          ))}
          {linkLines.map((line) => (
            <path
              key={line.to}
              d={line.d}
              fill="none"
              stroke="var(--accent)"
              strokeWidth={2 / cam.k}
              strokeDasharray={line.newTab ? `${6 / cam.k} ${4 / cam.k}` : undefined}
              opacity={0.8}
            />
          ))}
        </svg>
        {layout.boxes.map((box) => {
          const view = byPath.get(box.path);
          return view ? (
            <ViewCard
              key={box.path}
              projectId={projectId}
              view={view}
              box={box}
              selected={box.path === selected}
              linked={linkedPaths.has(box.path)}
              onSelect={onSelect}
            />
          ) : null;
        })}
      </div>
      <div className="absolute bottom-3 left-3 flex items-center gap-1 rounded-lg border border-border bg-bg-secondary p-1 text-text-secondary">
        <button
          type="button"
          title="Zoom out"
          className="rounded p-1 hover:bg-bg-tertiary"
          onClick={() => zoomBy(1 / 1.25)}
        >
          <Minus className="h-3.5 w-3.5" />
        </button>
        <span className="w-10 text-center text-[11px] tabular-nums">
          {Math.round(cam.k * 100)}%
        </span>
        <button
          type="button"
          title="Zoom in"
          className="rounded p-1 hover:bg-bg-tertiary"
          onClick={() => zoomBy(1.25)}
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          title="Fit all views"
          className="rounded p-1 hover:bg-bg-tertiary"
          onClick={() => setCamera(null)}
        >
          <Maximize className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}
