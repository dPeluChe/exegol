import { launchHint, MODEL_ROLES, type ModelRole, roleModelProblem } from "@exegol/shared";
import { cn } from "@exegol/ui";
import { Plus, X } from "lucide-react";
import { useState } from "react";
import { shallow } from "zustand/shallow";
import {
  BUILT_IN_PRESETS,
  type ModelPreset,
  useModelPresetStore,
} from "../../stores/model-presets";
import { INPUT_CLASS } from "./SpawnOptions";

/** This CLI's built-in and saved presets */
export function usePresets(providerId: string): ModelPreset[] {
  const saved = useModelPresetStore((s) => s.saved);
  return [...BUILT_IN_PRESETS, ...saved].filter((p) => p.cliType === providerId);
}

/** "sonnet main · opus advisor · haiku subagents" */
function presetSummary(providerId: string, preset: Pick<ModelPreset, "model" | "roles">) {
  const defs = MODEL_ROLES[providerId] ?? [];
  return [
    preset.model && `${preset.model} main`,
    ...Object.entries(preset.roles).map(([id, m]) => {
      const label = defs.find((d) => d.id === id)?.label ?? id;
      return `${m} ${label.toLowerCase()}`;
    }),
  ]
    .filter(Boolean)
    .join(" · ");
}

/** Presets that set the main model and the roles in one click, plus "Save as preset" */
export function PresetCards({
  providerId,
  model,
  roles,
  onPreset,
}: {
  providerId: string;
  model: string;
  roles: Record<string, string>;
  onPreset: (preset: Pick<ModelPreset, "model" | "roles">) => void;
}) {
  const saved = useModelPresetStore((s) => s.saved);
  const savePreset = useModelPresetStore((s) => s.save);
  const removePreset = useModelPresetStore((s) => s.remove);
  const presets = usePresets(providerId);
  const [naming, setNaming] = useState<string | null>(null);

  const active = presets.find((p) => p.model === model.trim() && shallow(p.roles, roles));
  const canSave = !active && (model.trim() !== "" || Object.keys(roles).length > 0);

  const commitName = () => {
    const name = naming?.trim();
    if (name) savePreset({ cliType: providerId, name, model: model.trim(), roles });
    setNaming(null);
  };

  if (presets.length === 0 && !canSave && naming === null) return null;
  return (
    <div className="flex flex-wrap items-stretch gap-1.5">
      {presets.map((p) => (
        <div key={p.id} className="group relative">
          <button
            type="button"
            onClick={() => onPreset(p)}
            className={cn(
              "flex h-full max-w-[200px] flex-col items-start gap-0.5 rounded-lg border px-2.5 py-1.5 text-left transition-all",
              p === active
                ? "border-accent/50 bg-accent/10 text-accent"
                : "border-border bg-bg-secondary text-text-secondary hover:border-accent/30",
            )}
          >
            <span className="text-[11px] font-medium">{p.name}</span>
            <span className="text-[10px] opacity-70">{presetSummary(providerId, p)}</span>
          </button>
          {saved.includes(p) && (
            <button
              type="button"
              onClick={() => removePreset(p.id)}
              aria-label={`Delete preset ${p.name}`}
              className="absolute top-1 right-1 rounded p-0.5 text-text-muted opacity-0 hover:text-red-400 focus:opacity-100 group-hover:opacity-100"
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
          className="flex items-center gap-1 rounded-lg border border-dashed border-border px-2.5 py-1.5 text-[11px] text-text-muted hover:border-accent/40 hover:text-text-secondary"
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
          className={cn(INPUT_CLASS, "w-40 self-center")}
        />
      )}
    </div>
  );
}

/** One advisor, subagent, planner or editor model field */
export function RoleField({
  providerId,
  role,
  model,
  value,
  onRole,
}: {
  providerId: string;
  role: ModelRole;
  model: string;
  value: string;
  onRole: (roleId: string, value: string) => void;
}) {
  const problem = value ? roleModelProblem(providerId, role.id, value, model) : null;
  const listId = `role-${role.id}-models`;
  return (
    <div className="flex flex-col gap-1">
      <label
        className="text-[11px] font-medium text-text-muted"
        htmlFor={`role-${role.id}`}
        title={role.hint}
      >
        {role.label} <span className="font-mono text-[10px]">{launchHint(role.launch)}</span>
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
      {problem && <span className="text-[10px] text-amber-400">{problem}: not passed</span>}
    </div>
  );
}
