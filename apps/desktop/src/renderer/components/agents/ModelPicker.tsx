import { launchHint, MODEL_LAUNCH, MODEL_ROLES } from "@exegol/shared";
import { cn } from "@exegol/ui";
import { type ModelMode, type ModelPreset, useModelPresetStore } from "../../stores/model-presets";
import { PresetCards, RoleField, SavePresetButton, usePresets } from "./ModelRolesPicker";
import { ModelSelect } from "./ModelSelect";
import { INPUT_CLASS } from "./SpawnOptions";

const LABEL_CLASS = "text-[11px] font-medium text-text-muted";

/** Model (for CLIs that take one at launch) and session name. A CLI with model roles or presets
 *  first offers one model or a combination; empty keeps the CLI's default and a codename */
export function ModelAndName({
  providerId,
  model,
  onModel,
  roles,
  onRole,
  onPreset,
  name,
  onName,
}: {
  providerId: string;
  model: string;
  onModel: (model: string) => void;
  roles: Record<string, string>;
  onRole: (roleId: string, value: string) => void;
  onPreset: (preset: Pick<ModelPreset, "model" | "roles">) => void;
  name: string;
  onName: (name: string) => void;
}) {
  const launch = MODEL_LAUNCH[providerId];
  const defs = MODEL_ROLES[providerId] ?? [];
  const presets = usePresets(providerId);
  const savedMode = useModelPresetStore((s) => s.modes[providerId]);
  const setMode = useModelPresetStore((s) => s.setMode);
  const hasCombos = !!launch && (defs.length > 0 || presets.length > 0);
  const mode: ModelMode = hasCombos ? (savedMode ?? "single") : "single";
  const label = providerId === "amp" ? "Mode" : "Model";

  const chooseMode = (next: ModelMode) => {
    setMode(providerId, next);
    if (next === "single") onPreset({ model, roles: {} });
  };

  const nameField = (
    <div className={cn("flex flex-col gap-1.5", (!launch || mode === "combo") && "col-span-2")}>
      <label className={LABEL_CLASS} htmlFor="spawn-name">
        Name <span className="text-text-muted">(optional)</span>
      </label>
      <input
        id="spawn-name"
        value={name}
        maxLength={40}
        onChange={(e) => onName(e.target.value)}
        placeholder="A codename if empty"
        className={INPUT_CLASS}
      />
    </div>
  );

  if (mode === "single" || !launch) {
    return (
      <div className="grid grid-cols-2 gap-3">
        {launch && (
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between gap-2">
              <label className={LABEL_CLASS} htmlFor="spawn-model" title={launchHint(launch)}>
                {label}
                {!hasCombos && (
                  <span className="ml-1 font-mono text-[10px]">{launchHint(launch)}</span>
                )}
              </label>
              {hasCombos && <ModelModeToggle mode={mode} onMode={chooseMode} />}
            </div>
            <ModelSelect
              id="spawn-model"
              providerId={providerId}
              label={label}
              value={model}
              onChange={onModel}
            />
          </div>
        )}
        {nameField}
      </div>
    );
  }

  // Odd field count: the last one spans both columns so the grid has no hole
  const lastSpans = defs.length % 2 === 0;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <span className={LABEL_CLASS}>{label}</span>
          <ModelModeToggle mode={mode} onMode={chooseMode} />
          <div className="ml-auto">
            <SavePresetButton providerId={providerId} model={model} roles={roles} />
          </div>
        </div>
        <PresetCards providerId={providerId} model={model} roles={roles} onPreset={onPreset} />
        <div className="grid grid-cols-2 gap-x-3 gap-y-2">
          <div className={cn("flex min-w-0 flex-col gap-1", defs.length === 0 && "col-span-2")}>
            <label className={LABEL_CLASS} htmlFor="spawn-model" title={launchHint(launch)}>
              Main
            </label>
            <ModelSelect
              id="spawn-model"
              providerId={providerId}
              label={label}
              value={model}
              onChange={onModel}
            />
          </div>
          {defs.map((role, i) => (
            <RoleField
              key={role.id}
              providerId={providerId}
              role={role}
              model={model}
              value={roles[role.id] ?? ""}
              onRole={onRole}
              className={cn(lastSpans && i === defs.length - 1 && "col-span-2")}
            />
          ))}
        </div>
      </div>
      {nameField}
    </div>
  );
}

function ModelModeToggle({ mode, onMode }: { mode: ModelMode; onMode: (m: ModelMode) => void }) {
  const option = (value: ModelMode, text: string, hint: string) => (
    <button
      type="button"
      aria-pressed={mode === value}
      onClick={() => onMode(value)}
      title={hint}
      className={cn(
        "rounded px-1.5 py-0.5 text-[10px] font-medium transition-colors",
        mode === value ? "bg-accent/15 text-accent" : "text-text-muted hover:text-text-secondary",
      )}
    >
      {text}
    </button>
  );
  return (
    <fieldset
      aria-label="Model setup"
      className="flex shrink-0 rounded-md border border-border bg-bg-secondary p-0.5"
    >
      {option("single", "Single model", "One model for everything")}
      {option("combo", "Combination", "A main model plus advisor, subagent or planner models")}
    </fieldset>
  );
}
