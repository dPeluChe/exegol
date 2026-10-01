import type { Project } from "@exegol/shared";
import * as Dialog from "@radix-ui/react-dialog";
import { LayoutGrid, Plus, Trash2, X } from "lucide-react";
import { useState } from "react";
import { describeLayout, openProjectLayout, saveProjectLayout } from "../../lib/project-layouts";
import { useToastStore } from "../../stores/toasts";
import { useWorkspaceStore } from "../../stores/workspace";

const ACTION =
  "rounded border border-border px-2 py-0.5 text-[10px] text-text-secondary hover:bg-white/5";

/** A project's saved layouts (its menu > Layouts...): save the current tab with a name, open
 *  one in a new tab or over the current one; terminals and agents start again as they were */
export function ProjectLayoutsDialog({
  project,
  onOpenChange,
}: {
  project: Project;
  onOpenChange: (open: boolean) => void;
}) {
  const all = useWorkspaceStore((s) => s.customLayouts);
  const deleteLayout = useWorkspaceStore((s) => s.deleteCustomLayout);
  const layouts = all.filter((l) => l.projectId === project.id);
  const [name, setName] = useState("");

  const save = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    if (saveProjectLayout(project.id, trimmed)) {
      setName("");
      useToastStore.getState().addToast({ type: "success", title: `Saved layout "${trimmed}"` });
    }
  };
  const open = (id: string, where: "new-tab" | "current-tab") => {
    const layout = layouts.find((l) => l.id === id);
    if (!layout) return;
    openProjectLayout(project.id, layout, where);
    onOpenChange(false);
  };

  return (
    <Dialog.Root open onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50" />
        <Dialog.Content className="fixed left-1/2 top-[15%] z-50 flex w-full max-w-md -translate-x-1/2 flex-col gap-3 rounded-xl border border-border bg-bg-secondary p-4 shadow-2xl">
          <div className="flex items-center justify-between">
            <Dialog.Title className="flex items-center gap-2 text-sm font-semibold text-text-primary">
              <LayoutGrid className="h-4 w-4" />
              Layouts · {project.name}
            </Dialog.Title>
            <Dialog.Close
              aria-label="Close"
              className="rounded p-1 text-text-muted hover:bg-white/10"
            >
              <X className="h-3.5 w-3.5" />
            </Dialog.Close>
          </div>
          <Dialog.Description className="text-[11px] text-text-muted">
            A layout keeps the tab's panes, their sizes and what each one runs: a browser at its
            page, a file, a terminal, or an agent with its model and YOLO, started again when you
            open it.
          </Dialog.Description>

          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              save();
            }}
          >
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Name for the current tab's layout"
              maxLength={40}
              aria-label="Layout name"
              className="flex-1 rounded-lg border border-border bg-bg-primary px-2.5 py-1.5 text-[11px] text-text-primary outline-none placeholder:text-text-muted focus:border-accent/50"
            />
            <button
              type="submit"
              disabled={!name.trim()}
              className="flex items-center gap-1 rounded-lg bg-accent px-3 py-1.5 text-[11px] font-semibold text-white disabled:opacity-40"
            >
              <Plus className="h-3 w-3" />
              Save current tab
            </button>
          </form>

          {layouts.length === 0 ? (
            <p className="text-[11px] text-text-muted">No layouts saved for this project yet.</p>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {layouts.map((l) => (
                <li
                  key={l.id}
                  className="flex items-center gap-2 rounded-lg border border-border bg-bg-primary px-3 py-2"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[11px] font-medium text-text-primary">{l.name}</p>
                    <p className="truncate text-[10px] text-text-muted">{describeLayout(l)}</p>
                  </div>
                  <button type="button" onClick={() => open(l.id, "new-tab")} className={ACTION}>
                    New tab
                  </button>
                  <button
                    type="button"
                    onClick={() => open(l.id, "current-tab")}
                    className={ACTION}
                    title="Rearrange the current tab: its panes keep what they show, missing ones are added"
                  >
                    Apply here
                  </button>
                  <button
                    type="button"
                    onClick={() => deleteLayout(l.id)}
                    aria-label={`Delete ${l.name}`}
                    className="rounded p-1 text-text-muted hover:bg-white/10 hover:text-red-400"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
