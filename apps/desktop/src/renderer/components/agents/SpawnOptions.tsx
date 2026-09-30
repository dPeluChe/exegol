import {
  type AgentAccessMode,
  type AgentProvider,
  MODEL_FLAGS,
  MODEL_ID_PATTERN,
  MODEL_SUGGESTIONS,
} from "@exegol/shared";
import { cn } from "@exegol/ui";
import { ChevronDown, ChevronRight, Sparkles, Zap } from "lucide-react";
import { type ReactNode, useState } from "react";
import { useProject } from "../../hooks/use-trpc";
import { useSkills } from "../../hooks/use-trpc-skills";
import { ACCESS_MODES } from "../../lib/access-modes";
import { AgentIcon } from "../common/AgentIcon";

/** One pickable pill in the launch modal (agent, session, mode, skill, place). */
export function SpawnChip({
  selected,
  onClick,
  title,
  className,
  children,
}: {
  selected: boolean;
  onClick: () => void;
  title?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={cn(
        className,
        "rounded-lg border px-2.5 py-1.5 text-[11px] font-medium transition-all",
        selected
          ? "border-accent/50 bg-accent/10 text-accent"
          : "border-border bg-bg-secondary text-text-secondary hover:border-accent/30",
      )}
    >
      {children}
    </button>
  );
}

export function ProviderPicker({
  providers,
  selectedId,
  onChoose,
}: {
  providers: AgentProvider[];
  selectedId: string;
  onChoose: (id: string) => void;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[11px] font-medium text-text-muted">Agent</span>
      <div className="flex flex-wrap gap-1.5">
        {providers.map((p) => (
          <SpawnChip
            key={p.id}
            selected={selectedId === p.id}
            onClick={() => onChoose(p.id)}
            className="flex items-center gap-1.5"
          >
            <AgentIcon provider={p.id} size={16} fallback={p.icon} fallbackColor={p.color} />
            {p.name}
          </SpawnChip>
        ))}
      </div>
    </div>
  );
}

/** Access mode (T58), plus the CLI's own YOLO flag when it has one. */
export function AccessModePicker({
  accessMode,
  onAccessMode,
  provider,
  yoloFlag,
  yolo,
  onYolo,
}: {
  accessMode: AgentAccessMode;
  onAccessMode: (mode: AgentAccessMode) => void;
  provider: AgentProvider | undefined;
  yoloFlag: string | undefined;
  yolo: boolean | null;
  onYolo: (yolo: boolean) => void;
}) {
  // What Settings > CLIs has configured for this provider — the checkbox shows
  // that until the user actually changes it, so an untouched launch inherits
  // rather than silently overriding.
  const providerYolo = !!yoloFlag && !!provider?.args.includes(yoloFlag);
  const yoloChecked = yolo ?? providerYolo;

  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[11px] font-medium text-text-muted">Mode</span>
      <div className="flex gap-1.5">
        {ACCESS_MODES.map(({ mode, label, icon: Icon, hint }) => (
          <SpawnChip
            key={mode}
            selected={accessMode === mode}
            onClick={() => onAccessMode(mode)}
            title={hint}
            className="flex items-center gap-1.5"
          >
            <Icon className="h-3 w-3" />
            {label}
          </SpawnChip>
        ))}
      </div>
      {/* Exegol's access mode instructs the agent; this bypasses the CLI's
          OWN confirmation prompts. Same question, two layers — so they
          belong together rather than as a second thing called "mode". */}
      {yoloFlag && (
        <label className="mt-0.5 flex cursor-pointer items-center gap-2" htmlFor="yolo-mode">
          <input
            type="checkbox"
            id="yolo-mode"
            checked={yoloChecked}
            onChange={(e) => onYolo(e.target.checked)}
            className="h-3.5 w-3.5 rounded border-border accent-accent"
          />
          <Zap className="h-3.5 w-3.5 text-text-muted" />
          <span className="text-[11px] text-text-secondary">
            Also skip this CLI's own confirmations{" "}
            <code className="text-text-muted">{yoloFlag}</code>
          </span>
        </label>
      )}
    </div>
  );
}

/** Skill picker — injected into the agent prompt via buildSpawnContext */
export function SkillPicker({
  projectId,
  selected,
  onToggle,
}: {
  projectId: string;
  selected: Set<string>;
  onToggle: (name: string) => void;
}) {
  const [showSkills, setShowSkills] = useState(false);
  const { data: project } = useProject(projectId);
  const { data: skills = [] } = useSkills(projectId, project?.path ?? null);
  const availableSkills = skills.filter((s) => s.available);

  if (availableSkills.length === 0) return null;
  return (
    <div className="flex flex-col gap-1.5">
      <button
        type="button"
        onClick={() => setShowSkills((v) => !v)}
        className="flex w-fit items-center gap-1 text-[11px] font-medium text-text-muted hover:text-text-secondary"
      >
        {showSkills ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        Skills (optional)
        {selected.size > 0 && <span className="text-accent">· {selected.size} selected</span>}
      </button>
      <div className={cn("flex-wrap gap-1.5", showSkills ? "flex" : "hidden")}>
        {availableSkills.map((s) => (
          <SpawnChip
            key={s.name}
            selected={selected.has(s.name)}
            onClick={() => onToggle(s.name)}
            title={s.description}
            className="flex items-center gap-1.5"
          >
            <Sparkles className="h-3 w-3" />
            {s.name}
          </SpawnChip>
        ))}
      </div>
    </div>
  );
}

const INPUT_CLASS =
  "w-full rounded-lg border border-border bg-bg-secondary px-2.5 py-1.5 text-[11px] text-text-primary outline-none placeholder:text-text-muted focus:border-accent/50";

/** Optional model (for CLIs that take one at launch) and session name; empty keeps the
 *  CLI's default model and a codename */
export function ModelAndName({
  providerId,
  model,
  onModel,
  name,
  onName,
}: {
  providerId: string;
  model: string;
  onModel: (model: string) => void;
  name: string;
  onName: (name: string) => void;
}) {
  const modelFlag = MODEL_FLAGS[providerId];
  const suggestions = MODEL_SUGGESTIONS[providerId] ?? [];
  const invalid = model.trim() !== "" && !MODEL_ID_PATTERN.test(model.trim());
  return (
    <div className="grid grid-cols-2 gap-3">
      {modelFlag && (
        <div className="flex flex-col gap-1.5">
          <label className="text-[11px] font-medium text-text-muted" htmlFor="spawn-model">
            Model <span className="font-mono text-[10px]">{modelFlag}</span>
          </label>
          <input
            id="spawn-model"
            list="spawn-model-options"
            value={model}
            onChange={(e) => onModel(e.target.value)}
            placeholder="CLI default"
            aria-invalid={invalid}
            className={cn(INPUT_CLASS, invalid && "border-red-500/60")}
          />
          <datalist id="spawn-model-options">
            {suggestions.map((m) => (
              <option key={m} value={m} />
            ))}
          </datalist>
        </div>
      )}
      <div className={cn("flex flex-col gap-1.5", !modelFlag && "col-span-2")}>
        <label className="text-[11px] font-medium text-text-muted" htmlFor="spawn-name">
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
    </div>
  );
}
