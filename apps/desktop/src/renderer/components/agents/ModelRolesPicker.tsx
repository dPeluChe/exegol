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
import { ModelSelect } from "./ModelSelect";
import { INPUT_CLASS } from "./SpawnOptions";

/** This CLI's built-in and saved presets */
export function usePresets(providerId: string): ModelPreset[] {
  const saved = useModelPresetStore((s) => s.saved);
  return [...BUILT_IN_PRESETS, ...saved].filter((p) => p.cliType === providerId);
}

/** The preset matching the current main model and roles; none and something set = savable */
function useActivePreset(providerId: string, model: string, roles: Record<string, string>) {
  const presets = usePresets(providerId);
  const active = presets.find((p) => p.model === model.trim() && shallow(p.roles, roles));
  const canSave = !active && (model.trim() !== "" || Object.keys(roles).length > 0);
  return { presets, active, canSave };
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

/** Presets that set the main model and the roles in one click, in an even grid */
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
  const removePreset = useModelPresetStore((s) => s.remove);
  const { presets, active } = useActivePreset(providerId, model, roles);

  if (presets.length === 0) return null;
  return (
    <div className="grid grid-cols-3 gap-1.5">
      {presets.map((p) => {
        const summary = presetSummary(providerId, p);
        return (
          <div key={p.id} className="group relative min-w-0">
            <button
              type="button"
              onClick={() => onPreset(p)}
              title={`${p.name}: ${summary}`}
              className={cn(
                "flex h-full min-h-[52px] w-full flex-col items-start gap-0.5 rounded-lg border px-2.5 py-1.5 text-left transition-all",
                p === active
                  ? "border-accent/50 bg-accent/10 text-accent"
                  : "border-border bg-bg-secondary text-text-secondary hover:border-accent/30",
              )}
            >
              <span className="w-full truncate pr-3 text-[11px] font-medium">{p.name}</span>
              <span className="line-clamp-2 text-[10px] opacity-70">{summary}</span>
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
        );
      })}
    </div>
  );
}

/** "Save as preset", then its name field, in the combination picker's header */
export function SavePresetButton({
  providerId,
  model,
  roles,
}: {
  providerId: string;
  model: string;
  roles: Record<string, string>;
}) {
  const savePreset = useModelPresetStore((s) => s.save);
  const { canSave } = useActivePreset(providerId, model, roles);
  const [naming, setNaming] = useState<string | null>(null);

  const commitName = () => {
    const name = naming?.trim();
    if (name) savePreset({ cliType: providerId, name, model: model.trim(), roles });
    setNaming(null);
  };

  if (naming !== null)
    return (
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
        className={cn(INPUT_CLASS, "w-40 py-0.5")}
      />
    );
  if (!canSave) return null;
  return (
    <button
      type="button"
      onClick={() => setNaming("")}
      className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] text-text-muted hover:bg-white/5 hover:text-text-secondary"
    >
      <Plus className="h-3 w-3" />
      Save as preset
    </button>
  );
}

/** One advisor, subagent, planner or editor model: the main model's dropdown without the models
 *  this role refuses. Default leaves the role unset */
export function RoleField({
  providerId,
  role,
  model,
  value,
  onRole,
  className,
}: {
  providerId: string;
  role: ModelRole;
  model: string;
  value: string;
  onRole: (roleId: string, value: string) => void;
  className?: string;
}) {
  const problem = value ? roleModelProblem(providerId, role.id, value, model) : null;
  const id = `role-${role.id}`;
  return (
    <div className={cn("flex min-w-0 flex-col gap-1", className)}>
      <label
        className="truncate text-[11px] font-medium text-text-muted"
        htmlFor={id}
        title={`${role.hint} (${launchHint(role.launch)})`}
      >
        {role.label}
      </label>
      <ModelSelect
        id={id}
        providerId={providerId}
        label={role.label}
        value={value}
        onChange={(v) => onRole(role.id, v.trim())}
        suggestions={role.suggestions}
        defaultLabel="Default (not set)"
        accepts={(m) => !roleModelProblem(providerId, role.id, m, model)}
        invalid={!!problem}
      />
      {problem && <span className="text-[10px] text-amber-400">{problem}: not passed</span>}
    </div>
  );
}
