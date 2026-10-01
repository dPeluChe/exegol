import { LayoutGrid, Save, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useProjectContext } from "../../contexts/ProjectContext";
import { dispatchRefitTerminals } from "../../lib/dispatch-refit";
import { LAYOUT_PRESETS, type LayoutPresetId } from "../../lib/layout-presets";
import { fillLayoutSlots, slotAgentOf, spawnShellIntoPane } from "../../lib/spawn-shell";
import { toastError, useToastStore } from "../../stores/toasts";
import { useWorkspaceStore } from "../../stores/workspace";

interface LayoutPresetsProps {
  tabId: string | null;
}

/**
 * Dropdown button in the tab bar that lets the user apply a canonical layout
 * preset (single, horizontal split, bottom terminal, 2×2 grid, etc) or a
 * user-saved custom layout template.
 */
export function LayoutPresets({ tabId }: LayoutPresetsProps) {
  const [open, setOpen] = useState(false);
  const [savingName, setSavingName] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const saveInputRef = useRef<HTMLInputElement>(null);

  const applyLayoutPreset = useWorkspaceStore((s) => s.applyLayoutPreset);
  const applyCustomLayout = useWorkspaceStore((s) => s.applyCustomLayout);
  const saveCustomLayout = useWorkspaceStore((s) => s.saveCustomLayout);
  const deleteCustomLayout = useWorkspaceStore((s) => s.deleteCustomLayout);
  // Global ones here; a project's own are in its menu (Layouts...)
  const allLayouts = useWorkspaceStore((s) => s.customLayouts);
  const customLayouts = allLayouts.filter((c) => !c.projectId);

  const { projectId } = useProjectContext();

  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
        setSavingName(null);
      }
    };
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        setSavingName(null);
      }
    };
    window.addEventListener("mousedown", handleClick);
    window.addEventListener("keydown", handleEsc);
    return () => {
      window.removeEventListener("mousedown", handleClick);
      window.removeEventListener("keydown", handleEsc);
    };
  }, [open]);

  const handlePickBuiltIn = async (presetId: LayoutPresetId) => {
    if (!tabId) return;
    const { terminalsToSpawn } = applyLayoutPreset(tabId, presetId);
    setOpen(false);
    // Spawn shells for preset slots marked as terminal (e.g. Bottom Terminal)
    if (projectId) {
      for (const paneId of terminalsToSpawn) {
        spawnShellIntoPane(projectId, paneId).catch(toastError("Failed to start terminal"));
      }
    }
    requestAnimationFrame(() => dispatchRefitTerminals());
  };

  const handlePickCustom = (customId: string) => {
    if (!tabId) return;
    const { spawns } = applyCustomLayout(tabId, customId);
    setOpen(false);
    if (projectId)
      fillLayoutSlots(projectId, spawns).catch(toastError("Failed to start a terminal"));
    requestAnimationFrame(() => dispatchRefitTerminals());
  };

  const handleStartSave = () => {
    setSavingName("");
    // Focus the input on next tick
    requestAnimationFrame(() => saveInputRef.current?.focus());
  };

  const handleConfirmSave = () => {
    if (!tabId || savingName === null) return;
    const trimmed = savingName.trim();
    if (!trimmed) {
      setSavingName(null);
      return;
    }
    const id = saveCustomLayout(tabId, trimmed, { agentOf: slotAgentOf });
    if (id) {
      useToastStore.getState().addToast({ type: "success", title: `Saved layout "${trimmed}"` });
    }
    setSavingName(null);
    setOpen(false);
  };

  const handleDeleteCustom = (customId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    deleteCustomLayout(customId);
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
          className="absolute right-0 top-8 z-50 min-w-[240px] rounded-lg border py-1 shadow-2xl"
          style={{
            background: "var(--bg-secondary)",
            borderColor: "var(--border)",
          }}
        >
          {/* Custom layouts (user-saved) */}
          {customLayouts.length > 0 && (
            <>
              <div className="px-2.5 py-1 text-[10px] uppercase tracking-wider text-text-muted">
                My Layouts
              </div>
              {customLayouts.map((c) => (
                <div
                  key={c.id}
                  className="group flex w-full items-center gap-2 px-2.5 py-1.5 text-[11px] text-text-secondary hover:bg-white/10"
                >
                  <button
                    type="button"
                    onClick={() => handlePickCustom(c.id)}
                    className="flex flex-1 items-center gap-2 text-left"
                  >
                    <LayoutGrid className="h-3.5 w-3.5 shrink-0 text-text-muted" />
                    <div className="flex-1 truncate">{c.name}</div>
                    <span className="text-[10px] text-text-muted">
                      {c.slots} slot{c.slots === 1 ? "" : "s"}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={(e) => handleDeleteCustom(c.id, e)}
                    className="flex h-4 w-4 shrink-0 items-center justify-center rounded text-text-muted opacity-0 transition-opacity hover:bg-red-400/80 hover:text-white group-hover:opacity-100"
                    title="Delete layout"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
              ))}
              <div className="my-1 border-t" style={{ borderColor: "var(--border)" }} />
            </>
          )}

          {/* Built-in layouts */}
          <div className="px-2.5 py-1 text-[10px] uppercase tracking-wider text-text-muted">
            Layout
          </div>
          {LAYOUT_PRESETS.map((preset) => (
            <button
              key={preset.id}
              type="button"
              onClick={() => handlePickBuiltIn(preset.id)}
              className="flex w-full items-center gap-2.5 px-2.5 py-1.5 text-left text-[11px] text-text-secondary transition-colors hover:bg-white/10"
            >
              <LayoutPresetGlyph presetId={preset.id} />
              <div className="flex-1">
                <div>{preset.label}</div>
                <div className="text-[10px] text-text-muted">{preset.description}</div>
              </div>
            </button>
          ))}

          <div className="my-1 border-t" style={{ borderColor: "var(--border)" }} />

          {/* Save current layout */}
          {savingName === null ? (
            <button
              type="button"
              onClick={handleStartSave}
              disabled={!tabId}
              className="flex w-full items-center gap-2.5 px-2.5 py-1.5 text-left text-[11px] text-text-secondary transition-colors hover:bg-white/10 disabled:opacity-40"
            >
              <Save className="h-3.5 w-3.5 shrink-0 text-text-muted" />
              <div className="flex-1">Save current layout…</div>
            </button>
          ) : (
            <div className="flex items-center gap-1.5 px-2.5 py-1.5">
              <Save className="h-3.5 w-3.5 shrink-0 text-text-muted" />
              <input
                ref={saveInputRef}
                value={savingName}
                onChange={(e) => setSavingName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleConfirmSave();
                  if (e.key === "Escape") setSavingName(null);
                }}
                onBlur={handleConfirmSave}
                placeholder="Layout name"
                aria-label="Layout name"
                className="h-5 flex-1 bg-transparent text-[11px] text-text-primary outline-none placeholder:text-text-muted/60"
              />
            </div>
          )}
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
