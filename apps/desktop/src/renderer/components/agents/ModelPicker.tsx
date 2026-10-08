import {
  launchHint,
  MODEL_ID_PATTERN,
  MODEL_LAUNCH,
  MODEL_ROLES,
  MODEL_SUGGESTIONS,
} from "@exegol/shared";
import { cn } from "@exegol/ui";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { trpcInvoke } from "../../lib/trpc-client";
import { type ModelMode, type ModelPreset, useModelPresetStore } from "../../stores/model-presets";
import { PresetCards, RoleField, usePresets } from "./ModelRolesPicker";
import { INPUT_CLASS } from "./SpawnOptions";

const OTHER = "__other__";

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
    <div className={cn("flex flex-col gap-1.5", !launch && "col-span-2")}>
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
            <ModelSelect providerId={providerId} label={label} model={model} onModel={onModel} />
          </div>
        )}
        {nameField}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <span className={LABEL_CLASS}>{label}</span>
        <ModelModeToggle mode={mode} onMode={chooseMode} />
      </div>
      <PresetCards providerId={providerId} model={model} roles={roles} onPreset={onPreset} />
      <div className="grid grid-cols-2 gap-x-3 gap-y-2">
        <div className="flex flex-col gap-1">
          <label className={LABEL_CLASS} htmlFor="spawn-model">
            Main <span className="font-mono text-[10px]">{launchHint(launch)}</span>
          </label>
          <ModelSelect providerId={providerId} label={label} model={model} onModel={onModel} />
        </div>
        {defs.map((role) => (
          <RoleField
            key={role.id}
            providerId={providerId}
            role={role}
            model={model}
            value={roles[role.id] ?? ""}
            onRole={onRole}
          />
        ))}
        {nameField}
      </div>
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

function ModelSelect({
  providerId,
  label,
  model,
  onModel,
}: {
  providerId: string;
  label: string;
  model: string;
  onModel: (model: string) => void;
}) {
  const { data: listed = [] } = useQuery({
    queryKey: ["cliModels", providerId],
    queryFn: () => trpcInvoke<string[]>("agents.listModels", { cliType: providerId }),
    staleTime: 10 * 60 * 1000,
  });
  const suggested = MODEL_SUGGESTIONS[providerId] ?? [];
  const available = listed.filter((m) => !suggested.includes(m));
  const known = new Set([...suggested, ...available]);
  // A typed id stays in its own field; "Other..." opens it
  const [custom, setCustom] = useState(false);
  const typing = custom || (model.trim() !== "" && !known.has(model));
  const invalid = model.trim() !== "" && !MODEL_ID_PATTERN.test(model.trim());
  return (
    <>
      <select
        id="spawn-model"
        value={typing ? OTHER : model}
        onChange={(e) => {
          const v = e.target.value;
          setCustom(v === OTHER);
          onModel(v === OTHER ? "" : v);
        }}
        className={cn(INPUT_CLASS, "cursor-pointer")}
      >
        <option value="">Default (the CLI's own setting)</option>
        {suggested.length > 0 && (
          <optgroup label="Suggested">
            {suggested.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </optgroup>
        )}
        {available.length > 0 && (
          <optgroup label="Available to your account">
            {available.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </optgroup>
        )}
        <option value={OTHER}>Other (type an id)...</option>
      </select>
      {typing && (
        <input
          // biome-ignore lint/a11y/noAutofocus: opened by choosing "Other", typing is next
          autoFocus
          value={model}
          onChange={(e) => onModel(e.target.value)}
          placeholder={`${label} id, e.g. ${suggested[0] ?? available[0] ?? "model-name"}`}
          aria-label={`${label} id`}
          aria-invalid={invalid}
          className={cn(INPUT_CLASS, invalid && "border-red-500/60")}
        />
      )}
    </>
  );
}
