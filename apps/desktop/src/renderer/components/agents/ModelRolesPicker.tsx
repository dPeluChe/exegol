import { launchHint, MODEL_ROLES, roleModelProblem } from "@exegol/shared";
import { cn } from "@exegol/ui";
import { ChevronDown, ChevronRight, Layers, Plus, X } from "lucide-react";
import { useState } from "react";
import { shallow } from "zustand/shallow";
import {
  BUILT_IN_PRESETS,
  type ModelPreset,
  useModelPresetStore,
} from "../../stores/model-presets";
import { INPUT_CLASS, SpawnChip } from "./SpawnOptions";

/** Advisor, subagent, planner or editor models for CLIs that take one at launch, plus presets
 *  that set the main model and the roles in one click */
export function ModelRolesPicker({
  providerId,
  model,
  roles,
  onRole,
  onPreset,
}: {
  providerId: string;
  model: string;
  roles: Record<string, string>;
  onRole: (roleId: string, value: string) => void;
  onPreset: (preset: Pick<ModelPreset, "model" | "roles">) => void;
}) {
  const defs = MODEL_ROLES[providerId] ?? [];
  const saved = useModelPresetStore((s) => s.saved);
  const savePreset = useModelPresetStore((s) => s.save);
  const removePreset = useModelPresetStore((s) => s.remove);
  const presets = [...BUILT_IN_PRESETS, ...saved].filter((p) => p.cliType === providerId);
  const [open, setOpen] = useState(Object.keys(roles).length > 0);
  const [naming, setNaming] = useState<string | null>(null);

  if (defs.length === 0 && presets.length === 0) return null;
  const active = presets.find((p) => p.model === model.trim() && shallow(p.roles, roles));
  const canSave = !active && (model.trim() !== "" || Object.keys(roles).length > 0);

  const commitName = () => {
    const name = naming?.trim();
    if (name) savePreset({ cliType: providerId, name, model: model.trim(), roles });
    setNaming(null);
  };

  return (
    <div className="flex flex-col gap-1.5">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-fit items-center gap-1 text-[11px] font-medium text-text-muted hover:text-text-secondary"
      >
        {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        Model roles and presets
        {Object.keys(roles).length > 0 && (
          <span className="text-accent">· {Object.keys(roles).length} set</span>
        )}
      </button>
      {open && (
        <div className="flex flex-col gap-2.5 rounded-lg border border-border/60 p-2.5">
          {(presets.length > 0 || canSave || naming !== null) && (
            <div className="flex flex-wrap items-center gap-1.5">
              {presets.map((p) => (
                <div key={p.id} className="group flex items-center gap-0.5">
                  <SpawnChip
                    selected={p === active}
                    onClick={() => onPreset(p)}
                    title={[
                      p.model && `Model: ${p.model}`,
                      ...Object.entries(p.roles).map(([r, m]) => `${r}: ${m}`),
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                    className="flex items-center gap-1.5"
                  >
                    <Layers className="h-3 w-3" />
                    {p.name}
                  </SpawnChip>
                  {saved.includes(p) && (
                    <button
                      type="button"
                      onClick={() => removePreset(p.id)}
                      aria-label={`Delete preset ${p.name}`}
                      className="rounded p-0.5 text-text-muted opacity-0 hover:text-red-400 focus:opacity-100 group-hover:opacity-100"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  )}
                </div>
              ))}
              {canSave && naming === null && (
                <button
                  type="button"
                  onClick={() => setNaming("")}
                  className="flex items-center gap-1 rounded-lg border border-dashed border-border px-2 py-1.5 text-[11px] text-text-muted hover:border-accent/40 hover:text-text-secondary"
                >
                  <Plus className="h-3 w-3" />
                  Save as preset
                </button>
              )}
              {naming !== null && (
                <input
                  // biome-ignore lint/a11y/noAutofocus: opened by "Save as preset", naming is next
                  autoFocus
                  value={naming}
                  maxLength={40}
                  onChange={(e) => setNaming(e.target.value)}
                  onBlur={commitName}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") commitName();
                    if (e.key === "Escape") {
                      e.stopPropagation();
                      setNaming(null);
                    }
                  }}
                  placeholder="Preset name"
                  aria-label="Preset name"
                  className={cn(INPUT_CLASS, "w-40")}
                />
              )}
            </div>
          )}
          {defs.length > 0 && (
            <div className="grid grid-cols-2 gap-2.5">
              {defs.map((role) => {
                const value = roles[role.id] ?? "";
                const problem = value ? roleModelProblem(providerId, role.id, value, model) : null;
                const listId = `role-${role.id}-models`;
                return (
                  <div key={role.id} className="flex flex-col gap-1">
                    <label
                      className="text-[11px] font-medium text-text-muted"
                      htmlFor={`role-${role.id}`}
                      title={role.hint}
                    >
                      {role.label}{" "}
                      <span className="font-mono text-[10px]">{launchHint(role.launch)}</span>
                    </label>
                    <input
                      id={`role-${role.id}`}
                      list={role.suggestions ? listId : undefined}
                      value={value}
                      onChange={(e) => onRole(role.id, e.target.value.trim())}
                      placeholder="Default"
                      title={role.hint}
                      aria-invalid={!!problem}
                      className={cn(INPUT_CLASS, problem && "border-amber-500/60")}
                    />
                    {role.suggestions && (
                      <datalist id={listId}>
                        {role.suggestions.map((m) => (
                          <option key={m} value={m} />
                        ))}
                      </datalist>
                    )}
                    {problem && (
                      <span className="text-[10px] text-amber-400">{problem}: not passed</span>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
