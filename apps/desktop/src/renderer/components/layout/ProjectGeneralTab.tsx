import { type IdeType, type InterruptionLevel, ideLabel, type Project } from "@exegol/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useProjectIde, useProjects, useSettings } from "../../hooks/use-trpc";
import { chordBadge } from "../../lib/keymap";
import { useProjectShortcuts } from "../../lib/live-tabs";
import { trpcInvoke, trpcMutate } from "../../lib/trpc-client";
import { attentionInterrupts, useAgentStore } from "../../stores/agents";
import { useNotificationPrefsStore } from "../../stores/notification-prefs";
import { SHORTCUT_DIGITS, type ShortcutDigit, useShortcutStore } from "../../stores/shortcuts";
import { toastError } from "../../stores/toasts";
import { SegmentedTabs } from "../common/SegmentedTabs";
import { IdePicker } from "../settings/IdePicker";
import { type FoundIcon, type ProjectAppearance, ProjectIconPicker } from "./ProjectIconPicker";

/** Name is a draft the dialog's Save commits; shortcut, IDE, interruptions, icon and color apply
 *  as they are picked */
export function ProjectGeneralTab({
  project,
  name,
  onName,
  onEnter,
}: {
  project: Project;
  name: string;
  onName: (name: string) => void;
  onEnter: () => void;
}) {
  const queryClient = useQueryClient();
  const { data: found = [], isLoading } = useQuery({
    queryKey: ["projects", "detectIcons", project.id],
    queryFn: () => trpcInvoke<FoundIcon[]>("projects.detectIcons", { id: project.id }),
  });
  const save = useMutation({
    mutationFn: (next: ProjectAppearance) =>
      trpcMutate("projects.setAppearance", { id: project.id, ...next }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["projects"], exact: true }),
  });

  return (
    <>
      <label className="mb-3 block">
        <span className="mb-1 block text-[10px] uppercase tracking-wider text-text-muted">
          Name
        </span>
        <input
          value={name}
          onChange={(e) => onName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") onEnter();
          }}
          className="w-full min-w-0 rounded border border-border bg-bg-tertiary px-2 py-1 text-xs text-text-primary outline-none focus:border-accent/50"
        />
      </label>

      <ShortcutPicker projectId={project.id} />

      <ProjectIdePicker projectId={project.id} />

      <InterruptionField projectId={project.id} />

      <ProjectIconPicker
        found={found}
        isLoading={isLoading}
        value={{
          color: project.color ?? null,
          icon: project.icon ?? null,
          iconImage: project.iconImage ?? null,
        }}
        onChange={(next) => save.mutate(next)}
      />
      {save.isError && <p className="mt-2 text-[11px] text-red-400">{String(save.error)}</p>}
      <button
        type="button"
        onClick={() => save.mutate({ color: null, icon: null, iconImage: null })}
        className="mt-2 text-[11px] text-text-muted hover:text-text-primary"
      >
        Reset icon and color
      </button>
    </>
  );
}

const INTERRUPTION_TABS: { id: InterruptionLevel; label: string }[] = [
  { id: "all", label: "All" },
  { id: "needs-me", label: "Only what needs me" },
  { id: "none", label: "Nothing" },
];

function InterruptionField({ projectId }: { projectId: string }) {
  const level = useNotificationPrefsStore((s) => s.levelOf(projectId));
  const change = (next: InterruptionLevel) => {
    useNotificationPrefsStore.getState().setLevel(projectId, next);
    const agents = useAgentStore.getState();
    for (const item of Object.values(agents.attentionItems)) {
      if (item.projectId === projectId && !attentionInterrupts(next, item.level)) {
        agents.markAttentionRead(item.agentId);
      }
    }
  };
  return (
    <div className="mb-3">
      <span className="mb-1 block text-[10px] uppercase tracking-wider text-text-muted">
        Interruptions
      </span>
      <SegmentedTabs
        tabs={INTERRUPTION_TABS}
        active={level}
        onChange={change}
        compact
        label="Interruptions"
      />
      <span className="mt-1 block text-[10px] text-text-muted">
        Notifications, toasts and unread badges of this project. Only what needs me keeps questions
        and failures. Attention items stay listed, and a session can still be muted on its own.
      </span>
    </div>
  );
}

/** The Cmd+digit this project keeps (lib/live-tabs): the others fill the numbers left. Each
 *  number says who has it now, kept by choice or given while live, so a change is informed */
function ShortcutPicker({ projectId }: { projectId: string }) {
  const assigned = useShortcutStore((s) => s.assigned);
  const assign = useShortcutStore((s) => s.assign);
  const live = useProjectShortcuts();
  const { data: projects = [] } = useProjects();
  const nameOf = new Map(projects.map((p) => [p.id, p.name]));
  const kept = new Map(Object.entries(assigned).map(([id, d]) => [d, id]));
  const given = new Map([...live].filter(([id]) => !assigned[id]).map(([id, d]) => [d, id]));
  const current = assigned[projectId] ?? "";
  const ownAuto = assigned[projectId] ? undefined : live.get(projectId);
  const ownerLabel = (d: ShortcutDigit) => {
    const keeper = kept.get(d);
    if (keeper && keeper !== projectId) return ` · ${nameOf.get(keeper) ?? "another project"}`;
    const auto = given.get(d);
    if (auto && auto !== projectId)
      return ` · ${nameOf.get(auto) ?? "another project"} (while live)`;
    return keeper === projectId || auto === projectId ? " · this project" : " · free";
  };

  return (
    <label className="mb-3 block">
      <span className="mb-1 block text-[10px] uppercase tracking-wider text-text-muted">
        Keyboard shortcut
      </span>
      <select
        value={current}
        onChange={(e) => assign(projectId, (e.target.value || null) as ShortcutDigit | null)}
        className="w-full rounded border border-border bg-bg-tertiary px-2 py-1 text-xs text-text-primary outline-none focus:border-accent/50"
      >
        <option value="">
          {ownAuto
            ? `Automatic (now ${chordBadge(ownAuto)}, while it has live sessions)`
            : "Automatic (next free number while it has live sessions)"}
        </option>
        {SHORTCUT_DIGITS.map((d) => (
          <option key={d} value={d}>
            {chordBadge(d)}
            {ownerLabel(d)}
          </option>
        ))}
      </select>
    </label>
  );
}

/** The IDE this project opens in; applies on pick, like the icon */
function ProjectIdePicker({ projectId }: { projectId: string }) {
  const queryClient = useQueryClient();
  const { data: settings } = useSettings();
  const { data: ide = null } = useProjectIde(projectId);
  const save = useMutation({
    mutationFn: (next: IdeType | null) => trpcMutate("ide.setProjectIde", { projectId, ide: next }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["ide", "project", projectId] }),
    onError: toastError("Could not save the project's IDE"),
  });
  return (
    <div className="mb-3">
      <span className="mb-1 block text-[10px] uppercase tracking-wider text-text-muted">IDE</span>
      <IdePicker
        compact
        value={ide}
        onChange={(next) => save.mutate(next)}
        follow={{ label: "Same as Settings", sub: ideLabel(settings?.defaultIde ?? "vscode") }}
      />
    </div>
  );
}
