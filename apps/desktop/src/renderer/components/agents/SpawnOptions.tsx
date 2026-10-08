import type { AgentAccessMode, AgentProvider } from "@exegol/shared";
import { cn } from "@exegol/ui";
import { ChevronDown, ChevronRight, Sparkles, Zap } from "lucide-react";
import { type ReactNode, useState } from "react";
import { isLaunchable } from "../../hooks/use-providers";
import { useProject } from "../../hooks/use-trpc";
import { useSkills } from "../../hooks/use-trpc-skills";
import { ACCESS_MODES } from "../../lib/access-modes";
import { openInBrowser } from "../../lib/open-in-browser";
import { runCommandInNewTab } from "../../lib/spawn-shell";
import { AgentIcon } from "../common/AgentIcon";
import { CopyCommand } from "../common/CopyCommand";

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
  const installed = providers.filter(isLaunchable);
  const missing = providers.filter((p) => !isLaunchable(p));
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

const HINT_BUTTON = "rounded border border-border px-2 py-0.5 text-[10px] hover:bg-white/5";

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
      {cmd && <CopyCommand label="Install" command={cmd} />}
      <div className="flex gap-2">
        {cmd && (
          <button
            type="button"
            onClick={() => runCommandInNewTab(projectId, cmd).catch(() => {})}
            className={HINT_BUTTON}
          >
            Install in a terminal
          </button>
        )}
        {provider.installDocs && (
          <button
            type="button"
            onClick={() => openInBrowser(provider.installDocs ?? "")}
            className={HINT_BUTTON}
          >
            Install guide
          </button>
        )}
        <button type="button" onClick={onRecheck} className={HINT_BUTTON}>
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

export const INPUT_CLASS =
  "w-full rounded-lg border border-border bg-bg-secondary px-2.5 py-1.5 text-[11px] text-text-primary outline-none placeholder:text-text-muted focus:border-accent/50";
