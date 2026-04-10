import { LayoutGrid } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { dispatchRefitTerminals } from "../../lib/dispatch-refit";
import { LAYOUT_PRESETS, type LayoutPresetId } from "../../lib/layout-presets";
import { useWorkspaceStore } from "../../stores/workspace";

interface LayoutPresetsProps {
  tabId: string | null;
}

/**
 * Dropdown button in the tab bar that lets the user apply a canonical layout
 * preset (single, horizontal split, bottom terminal, 2×2 grid, etc).
 */
export function LayoutPresets({ tabId }: LayoutPresetsProps) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const applyLayoutPreset = useWorkspaceStore((s) => s.applyLayoutPreset);

  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("mousedown", handleClick);
    window.addEventListener("keydown", handleEsc);
    return () => {
      window.removeEventListener("mousedown", handleClick);
      window.removeEventListener("keydown", handleEsc);
    };
  }, [open]);

  const handlePick = (presetId: LayoutPresetId) => {
    if (!tabId) return;
    applyLayoutPreset(tabId, presetId);
    setOpen(false);
    // Terminals need a refit after the layout tree is rewritten
    requestAnimationFrame(() => dispatchRefitTerminals());
  };

  return (
    <div className="relative" ref={menuRef}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        disabled={!tabId}
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded text-text-muted transition-colors hover:bg-white/5 disabled:opacity-40"
        title="Layout presets"
      >
        <LayoutGrid className="h-3.5 w-3.5" />
      </button>

      {open && (
        <div
          className="absolute right-0 top-8 z-50 min-w-[220px] rounded-lg border py-1 shadow-2xl"
          style={{
            background: "var(--bg-secondary)",
            borderColor: "var(--border)",
          }}
        >
          <div className="px-2.5 py-1 text-[10px] uppercase tracking-wider text-text-muted">
            Layout
          </div>
          {LAYOUT_PRESETS.map((preset) => (
            <button
              key={preset.id}
              type="button"
              onClick={() => handlePick(preset.id)}
              className="flex w-full items-center gap-2.5 px-2.5 py-1.5 text-left text-[11px] text-text-secondary transition-colors hover:bg-white/10"
            >
              <LayoutPresetGlyph presetId={preset.id} />
              <div className="flex-1">
                <div>{preset.label}</div>
                <div className="text-[10px] text-text-muted">{preset.description}</div>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Tiny SVG glyph that visually previews each preset's shape. */
function LayoutPresetGlyph({ presetId }: { presetId: LayoutPresetId }) {
  const stroke = "currentColor";
  const common = "h-5 w-6 shrink-0 text-text-muted";
  switch (presetId) {
    case "single":
      return (
        <svg
          aria-hidden="true"
          className={common}
          viewBox="0 0 24 20"
          fill="none"
          stroke={stroke}
          strokeWidth={1.5}
        >
          <rect x={2} y={2} width={20} height={16} rx={1.5} />
        </svg>
      );
    case "split-horizontal":
      return (
        <svg
          aria-hidden="true"
          className={common}
          viewBox="0 0 24 20"
          fill="none"
          stroke={stroke}
          strokeWidth={1.5}
        >
          <rect x={2} y={2} width={20} height={16} rx={1.5} />
          <line x1={12} y1={2} x2={12} y2={18} />
        </svg>
      );
    case "split-vertical":
      return (
        <svg
          aria-hidden="true"
          className={common}
          viewBox="0 0 24 20"
          fill="none"
          stroke={stroke}
          strokeWidth={1.5}
        >
          <rect x={2} y={2} width={20} height={16} rx={1.5} />
          <line x1={2} y1={10} x2={22} y2={10} />
        </svg>
      );
    case "three-columns":
      return (
        <svg
          aria-hidden="true"
          className={common}
          viewBox="0 0 24 20"
          fill="none"
          stroke={stroke}
          strokeWidth={1.5}
        >
          <rect x={2} y={2} width={20} height={16} rx={1.5} />
          <line x1={8.67} y1={2} x2={8.67} y2={18} />
          <line x1={15.33} y1={2} x2={15.33} y2={18} />
        </svg>
      );
    case "bottom-terminal":
      return (
        <svg
          aria-hidden="true"
          className={common}
          viewBox="0 0 24 20"
          fill="none"
          stroke={stroke}
          strokeWidth={1.5}
        >
          <rect x={2} y={2} width={20} height={16} rx={1.5} />
          <line x1={2} y1={13} x2={22} y2={13} />
        </svg>
      );
    case "two-by-two":
      return (
        <svg
          aria-hidden="true"
          className={common}
          viewBox="0 0 24 20"
          fill="none"
          stroke={stroke}
          strokeWidth={1.5}
        >
          <rect x={2} y={2} width={20} height={16} rx={1.5} />
          <line x1={12} y1={2} x2={12} y2={18} />
          <line x1={2} y1={10} x2={22} y2={10} />
        </svg>
      );
  }
}
