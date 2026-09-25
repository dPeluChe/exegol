import type { Project } from "@exegol/shared";
import * as Dialog from "@radix-ui/react-dialog";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { X } from "lucide-react";
import { trpcInvoke, trpcMutate } from "../../lib/trpc-client";
import { GroupIconColorPicker } from "./GroupIconColorPicker";

/**
 * Icon and color for a project: an image found in the repo (the app's own
 * favicon or icon, root or any subrepo) or a built-in icon, plus a color.
 */
export function ProjectAppearanceDialog({
  project,
  open,
  onOpenChange,
}: {
  project: Project;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const { data: found = [], isLoading } = useQuery({
    queryKey: ["projects", "detectIcons", project.id],
    queryFn: () =>
      trpcInvoke<{ path: string; rel: string; dataUrl: string }[]>("projects.detectIcons", {
        id: project.id,
      }),
    enabled: open,
  });
  const save = useMutation({
    mutationFn: (next: { color: string | null; icon: string | null; iconImage: string | null }) =>
      trpcMutate("projects.setAppearance", { id: project.id, ...next }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["projects"] }),
  });
  const color = project.color ?? null;

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
              {project.name}: icon and color
            </Dialog.Title>
            <Dialog.Close className="rounded p-1 text-text-muted hover:bg-white/10">
              <X className="h-3.5 w-3.5" />
            </Dialog.Close>
          </div>

          <p className="mb-1 text-[10px] uppercase tracking-wider text-text-muted">
            Found in the project
          </p>
          {isLoading ? (
            <p className="mb-3 text-[11px] text-text-muted">Looking...</p>
          ) : found.length === 0 ? (
            <p className="mb-3 text-[11px] text-text-muted">No favicon or app icon found.</p>
          ) : (
            <div className="mb-3 flex flex-wrap gap-1.5">
              {found.map((f) => (
                <button
                  key={f.path}
                  type="button"
                  onClick={() => save.mutate({ color, icon: null, iconImage: f.path })}
                  className={
                    project.iconImage === f.path
                      ? "rounded-md bg-white/10 p-1.5 ring-1 ring-accent/60"
                      : "rounded-md p-1.5 hover:bg-white/10"
                  }
                  title={f.rel}
                >
                  <img src={f.dataUrl} alt={f.rel} className="h-7 w-7 object-contain" />
                </button>
              ))}
            </div>
          )}

          <p className="mb-1 text-[10px] uppercase tracking-wider text-text-muted">
            Built-in icon and color
          </p>
          <GroupIconColorPicker
            color={project.color ?? null}
            icon={project.icon ?? null}
            onChange={(nextColor, nextIcon) =>
              // Choosing a built-in icon drops the image; a color applies to either
              save.mutate({
                color: nextColor,
                icon: nextIcon,
                iconImage: nextIcon === project.icon ? (project.iconImage ?? null) : null,
              })
            }
          />
          <button
            type="button"
            onClick={() => save.mutate({ color: null, icon: null, iconImage: null })}
            className="mt-2 text-[11px] text-text-muted hover:text-text-primary"
          >
            Reset to default
          </button>
          {save.isError && <p className="mt-2 text-[11px] text-red-400">{String(save.error)}</p>}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
