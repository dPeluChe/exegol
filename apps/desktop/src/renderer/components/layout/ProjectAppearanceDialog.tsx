import type { Project } from "@exegol/shared";
import * as Dialog from "@radix-ui/react-dialog";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { X } from "lucide-react";
import { useState } from "react";
import { useProjects } from "../../hooks/use-trpc";
import { chordBadge } from "../../lib/keymap";
import { useProjectShortcuts } from "../../lib/live-tabs";
import { trpcInvoke, trpcMutate } from "../../lib/trpc-client";
import { SHORTCUT_DIGITS, type ShortcutDigit, useShortcutStore } from "../../stores/shortcuts";
import { type FoundIcon, type ProjectAppearance, ProjectIconPicker } from "./ProjectIconPicker";

/**
 * Edit a project in one place: its name, and its icon (an image found in the repo,
 * the app's own favicon or icon, root or any subrepo, or a built-in one) and color.
 */
export function ProjectAppearanceDialog({
  project,
  open,
  onOpenChange,
  onRename,
}: {
  project: Project;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRename: (name: string) => void;
}) {
  const queryClient = useQueryClient();
  const { data: found = [], isLoading } = useQuery({
    queryKey: ["projects", "detectIcons", project.id],
    queryFn: () =>
      trpcInvoke<FoundIcon[]>("projects.detectIcons", {
        id: project.id,
      }),
    enabled: open,
  });
  const save = useMutation({
    mutationFn: (next: ProjectAppearance) =>
      trpcMutate("projects.setAppearance", { id: project.id, ...next }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["projects"] }),
  });
  const [name, setName] = useState(project.name);
  // Icon and color apply as they are picked; Save commits the name and closes
  const saveAndClose = () => {
    const trimmed = name.trim();
    if (trimmed && trimmed !== project.name) onRename(trimmed);
    onOpenChange(false);
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/60" />
        <Dialog.Content
          className="fixed left-1/2 top-1/4 z-50 w-full max-w-sm -translate-x-1/2 rounded-lg border p-4 shadow-2xl"
          style={{ background: "var(--bg-secondary)", borderColor: "var(--border)" }}
        >
          <div className="mb-3 flex items-center justify-between">
            <Dialog.Title className="text-sm font-semibold text-text-primary">
              Edit project
            </Dialog.Title>
            <Dialog.Close className="rounded p-1 text-text-muted hover:bg-white/10">
              <X className="h-3.5 w-3.5" />
            </Dialog.Close>
          </div>

          <label className="mb-3 block">
            <span className="mb-1 block text-[10px] uppercase tracking-wider text-text-muted">
              Name
            </span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") saveAndClose();
              }}
              className="w-full min-w-0 rounded border border-border bg-bg-tertiary px-2 py-1 text-xs text-text-primary outline-none focus:border-accent/50"
            />
          </label>

          <ShortcutPicker projectId={project.id} />

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
          <div className="mt-4 flex items-center justify-between">
            <button
              type="button"
              onClick={() => save.mutate({ color: null, icon: null, iconImage: null })}
              className="text-[11px] text-text-muted hover:text-text-primary"
            >
              Reset to default
            </button>
            <button
              type="button"
              onClick={saveAndClose}
              className="rounded-md bg-accent px-3 py-1 text-xs font-medium text-white hover:bg-accent/90"
            >
              Save
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/** The Cmd+digit this project keeps (lib/live-tabs): the others fill the numbers left. Each
 *  number says who has it now, kept by choice or given for a live tab, so a change is informed */
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
    if (auto && auto !== projectId) return ` · ${nameOf.get(auto) ?? "another project"} (live tab)`;
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
            ? `Automatic (now ${chordBadge(ownAuto)}, while it has a live tab)`
            : "Automatic (next free number while it has a live tab)"}
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
