import {
  type AgentAccessMode,
  type AgentProvider,
  MODEL_ID_PATTERN,
  MODEL_LAUNCH,
  MODEL_SUGGESTIONS,
  type ModelLaunch,
} from "@exegol/shared";
import { cn } from "@exegol/ui";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, Sparkles, Zap } from "lucide-react";
import { type ReactNode, useState } from "react";
import { useProject } from "../../hooks/use-trpc";
import { useSkills } from "../../hooks/use-trpc-skills";
import { ACCESS_MODES } from "../../lib/access-modes";
import { runCommandInNewTab } from "../../lib/spawn-shell";
import { trpcInvoke } from "../../lib/trpc-client";
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
  const installed = providers.filter((p) => p.installed !== false);
  const missing = providers.filter((p) => p.installed === false);
  const chip = (p: AgentProvider, dim: boolean) => (
    <SpawnChip
      key={p.id}
      selected={selectedId === p.id}
      onClick={() => onChoose(p.id)}
      title={dim ? `${p.name} is not installed on this machine` : undefined}
      className={cn("flex items-center gap-1.5", dim && "opacity-50")}
    >
      <AgentIcon provider={p.id} size={16} fallback={p.icon} fallbackColor={p.color} />
      {p.name}
    </SpawnChip>
  );
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[11px] font-medium text-text-muted">Agent</span>
      <div className="flex flex-wrap gap-1.5">{installed.map((p) => chip(p, false))}</div>
      {missing.length > 0 && (
        <>
          <span className="mt-1 text-[10px] text-text-muted">Not installed</span>
          <div className="flex flex-wrap gap-1.5">{missing.map((p) => chip(p, true))}</div>
        </>
      )}
    </div>
  );
}

/** A CLI that is not on PATH: launching it would only print "command not found" in the pane */
export function InstallHint({
  provider,
  projectId,
  onRecheck,
}: {
  provider: AgentProvider;
  projectId: string;
  onRecheck: () => void;
}) {
  const cmd = provider.installCommand;
  return (
    <div className="flex flex-col gap-1.5 rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-[11px] text-text-secondary">
      <span>
        <span className="font-medium text-text-primary">{provider.name}</span> is not installed here
        (no <code className="font-mono">{provider.command}</code> on your PATH). Install it first
        {cmd ? ":" : ", then check again."}
      </span>
      {cmd && <code className="select-all break-all font-mono text-[10px]">{cmd}</code>}
      <div className="flex gap-2">
        {cmd && (
          <button
            type="button"
            onClick={() => runCommandInNewTab(projectId, cmd).catch(() => {})}
            className="rounded border border-border px-2 py-0.5 text-[10px] hover:bg-white/5"
          >
            Install in a terminal
          </button>
        )}
        <button
          type="button"
          onClick={onRecheck}
          className="rounded border border-border px-2 py-0.5 text-[10px] hover:bg-white/5"
        >
          Check again
        </button>
      </div>
    </div>
  );
}

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
  const launch = MODEL_LAUNCH[providerId];
  const { data: listed = [] } = useQuery({
    queryKey: ["cliModels", providerId],
    queryFn: () => trpcInvoke<string[]>("agents.listModels", { cliType: providerId }),
    enabled: !!launch,
    staleTime: 10 * 60 * 1000,
  });
  const suggestions = [...new Set([...(MODEL_SUGGESTIONS[providerId] ?? []), ...listed])];
  const invalid = model.trim() !== "" && !MODEL_ID_PATTERN.test(model.trim());
  return (
    <div className="grid grid-cols-2 gap-3">
      {launch && (
        <div className="flex flex-col gap-1.5">
          <label className="text-[11px] font-medium text-text-muted" htmlFor="spawn-model">
            {providerId === "amp" ? "Mode" : "Model"}{" "}
            <span className="font-mono text-[10px]">{launchHint(launch)}</span>
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
      <div className={cn("flex flex-col gap-1.5", !launch && "col-span-2")}>
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

function launchHint(launch: ModelLaunch): string {
  if ("flag" in launch) return launch.flag;
  if ("env" in launch) return launch.env;
  return "--settings";
}
