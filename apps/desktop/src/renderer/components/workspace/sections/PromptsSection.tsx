import type { Prompt, PromptCategory } from "@exegol/shared";
import { Badge, Button, cn, ScrollArea } from "@exegol/ui";
import * as Dialog from "@radix-ui/react-dialog";
import { Copy, FileText, Pin, Plus, Rocket, Trash2, X } from "lucide-react";
import { useCallback, useState } from "react";
import { useProjectContext } from "../../../contexts/ProjectContext";
import {
  useCreatePrompt,
  useDeletePrompt,
  usePrompts,
  useTogglePinPrompt,
  useUpdatePrompt,
} from "../../../hooks/use-trpc";
import { ConfirmDialog } from "../../common/ConfirmDialog";
import { EmptyState } from "../../common/EmptyState";

const CATEGORIES: { id: PromptCategory | "all"; label: string }[] = [
  { id: "all", label: "All" },
  { id: "task", label: "Task" },
  { id: "review", label: "Review" },
  { id: "debug", label: "Debug" },
  { id: "custom", label: "Custom" },
];

const CATEGORY_COLORS: Record<PromptCategory, string> = {
  task: "bg-blue-500/20 text-blue-400",
  review: "bg-green-500/20 text-green-400",
  debug: "bg-red-500/20 text-red-400",
  custom: "bg-zinc-500/20 text-zinc-400",
};

export function PromptsSection() {
  const { projectId } = useProjectContext();
  const { data: prompts } = usePrompts(projectId);
  const [filterCategory, setFilterCategory] = useState<PromptCategory | "all">("all");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingPrompt, setEditingPrompt] = useState<Prompt | null>(null);

  const filtered = prompts?.filter(
    (p) => filterCategory === "all" || p.category === filterCategory,
  );

  const handleEdit = useCallback((prompt: Prompt) => {
    setEditingPrompt(prompt);
    setDialogOpen(true);
  }, []);

  const handleNew = useCallback(() => {
    setEditingPrompt(null);
    setDialogOpen(true);
  }, []);

  return (
    <div className="flex h-full flex-col">
      {/* Top bar */}
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border bg-bg-secondary px-3">
        <FileText className="h-4 w-4 text-text-muted" />
        <span className="text-xs font-medium text-text-primary">Prompts</span>

        {/* Category filter */}
        <div className="ml-3 flex gap-1">
          {CATEGORIES.map((cat) => (
            <button
              type="button"
              key={cat.id}
              onClick={() => setFilterCategory(cat.id)}
              className={cn(
                "rounded px-2 py-0.5 text-[10px] font-medium transition-colors",
                filterCategory === cat.id
                  ? "bg-accent/20 text-accent"
                  : "text-text-muted hover:text-text-secondary",
              )}
            >
              {cat.label}
            </button>
          ))}
        </div>

        <Button
          type="button"
          onClick={handleNew}
          className="ml-auto h-7 gap-1.5 bg-accent px-2 text-[11px] text-white"
        >
          <Plus className="h-3 w-3" />
          New Prompt
        </Button>
      </div>

      {/* Content */}
      {!filtered || filtered.length === 0 ? (
        <div className="flex h-full items-center justify-center">
          <EmptyState
            icon={<FileText className="h-8 w-8 text-text-muted" />}
            title="No prompts yet"
            description="Save reusable prompts for quick access when launching agents."
            action={{ label: "Create Prompt", onClick: handleNew }}
          />
        </div>
      ) : (
        <ScrollArea className="flex-1">
          <div className="grid gap-2 p-3 sm:grid-cols-2 lg:grid-cols-3">
            {filtered.map((prompt) => (
              <PromptCard key={prompt.id} prompt={prompt} onEdit={() => handleEdit(prompt)} />
            ))}
          </div>
        </ScrollArea>
      )}

      {/* Create/Edit dialog */}
      <PromptDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        prompt={editingPrompt}
        projectId={projectId}
      />
    </div>
  );
}

// ─── Prompt Card ────────────────────────────────────────────────────────────

function PromptCard({ prompt, onEdit }: { prompt: Prompt; onEdit: () => void }) {
  const togglePin = useTogglePinPrompt();
  const deletePrompt = useDeletePrompt();
  const [confirmDelete, setConfirmDelete] = useState(false);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(prompt.content);
  }, [prompt.content]);

  const handleUse = useCallback(() => {
    window.dispatchEvent(
      new CustomEvent("exegol:spawn-agent-with-prompt", {
        detail: { content: prompt.content },
      }),
    );
    window.dispatchEvent(new CustomEvent("exegol:spawn-agent"));
  }, [prompt.content]);

  return (
    <div className="group flex flex-col gap-2 rounded-lg border border-border bg-bg-secondary p-3">
      <div className="flex items-start justify-between gap-2">
        <button
          type="button"
          onClick={onEdit}
          className="flex-1 text-left text-xs font-medium text-text-primary hover:text-accent"
        >
          {prompt.title}
        </button>
        <div className="flex shrink-0 items-center gap-1">
          <Badge className={cn("text-[9px]", CATEGORY_COLORS[prompt.category])}>
            {prompt.category}
          </Badge>
          <button
            type="button"
            onClick={() => togglePin.mutate(prompt.id)}
            className={cn(
              "flex h-5 w-5 items-center justify-center rounded transition-colors",
              prompt.pinned ? "text-accent" : "text-text-muted hover:text-text-secondary",
            )}
          >
            <Pin className="h-3 w-3" />
          </button>
        </div>
      </div>

      <p className="line-clamp-2 text-[11px] text-text-muted">{prompt.content}</p>

      <div className="flex items-center gap-1 pt-1">
        <button
          type="button"
          onClick={handleCopy}
          className="flex h-6 items-center gap-1 rounded bg-bg-tertiary px-2 text-[10px] text-text-secondary transition-colors hover:text-text-primary"
        >
          <Copy className="h-3 w-3" />
          Copy
        </button>
        <button
          type="button"
          onClick={handleUse}
          className="flex h-6 items-center gap-1 rounded bg-accent/10 px-2 text-[10px] text-accent transition-colors hover:bg-accent/20"
        >
          <Rocket className="h-3 w-3" />
          Use
        </button>
        <button
          type="button"
          onClick={() => setConfirmDelete(true)}
          className="ml-auto flex h-6 w-6 items-center justify-center rounded text-text-muted opacity-0 transition-all hover:text-error group-hover:opacity-100"
        >
          <Trash2 className="h-3 w-3" />
        </button>
      </div>

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Delete Prompt"
        description={`Are you sure you want to delete "${prompt.title}"? This cannot be undone.`}
        confirmLabel="Delete"
        variant="destructive"
        onConfirm={() => deletePrompt.mutate(prompt.id)}
      />
    </div>
  );
}

// ─── Create/Edit Dialog ─────────────────────────────────────────────────────

function PromptDialog({
  open,
  onOpenChange,
  prompt,
  projectId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  prompt: Prompt | null;
  projectId: string | null;
}) {
  const createPrompt = useCreatePrompt();
  const updatePrompt = useUpdatePrompt();

  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [category, setCategory] = useState<PromptCategory>("custom");

  // Reset form when prompt changes
  const handleOpenChange = useCallback(
    (isOpen: boolean) => {
      if (isOpen && prompt) {
        setTitle(prompt.title);
        setContent(prompt.content);
        setCategory(prompt.category);
      } else if (isOpen) {
        setTitle("");
        setContent("");
        setCategory("custom");
      }
      onOpenChange(isOpen);
    },
    [prompt, onOpenChange],
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !content.trim() || !projectId) return;

    if (prompt) {
      await updatePrompt.mutateAsync({ id: prompt.id, title, content, category });
    } else {
      await createPrompt.mutateAsync({ projectId, title, content, category });
    }
    onOpenChange(false);
  };

  return (
    <Dialog.Root open={open} onOpenChange={handleOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/60" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-lg border border-border bg-bg-secondary p-6 shadow-2xl">
          <div className="mb-4 flex items-center justify-between">
            <Dialog.Title className="text-base font-semibold text-text-primary">
              {prompt ? "Edit Prompt" : "New Prompt"}
            </Dialog.Title>
            <Dialog.Close asChild>
              <button
                type="button"
                className="flex h-6 w-6 items-center justify-center rounded text-text-muted transition-colors hover:bg-white/10"
              >
                <X className="h-4 w-4" />
              </button>
            </Dialog.Close>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <div className="text-xs font-medium text-text-secondary">Title</div>
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Prompt title..."
                className="flex h-9 w-full rounded-md border border-border bg-bg-tertiary px-3 py-1 text-sm text-text-primary transition-colors focus:outline-none focus:ring-1"
              />
            </div>

            <div className="space-y-1.5">
              <div className="text-xs font-medium text-text-secondary">Content</div>
              <textarea
                value={content}
                onChange={(e) => setContent(e.target.value)}
                placeholder="Write your prompt..."
                rows={5}
                className="flex w-full rounded-md border border-border bg-bg-tertiary px-3 py-2 text-sm text-text-primary transition-colors placeholder:text-zinc-600 focus:outline-none focus:ring-1"
                style={{ resize: "vertical" }}
              />
            </div>

            <div className="space-y-1.5">
              <div className="text-xs font-medium text-text-secondary">Category</div>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value as PromptCategory)}
                className="flex h-9 w-full rounded-md border border-border bg-bg-tertiary px-3 py-1 text-sm text-text-primary transition-colors focus:outline-none focus:ring-1"
              >
                <option value="task">Task</option>
                <option value="review">Review</option>
                <option value="debug">Debug</option>
                <option value="custom">Custom</option>
              </select>
            </div>

            <div className="flex justify-end pt-2">
              <Button
                type="submit"
                disabled={!title.trim() || !content.trim()}
                className="gap-2 bg-accent text-white"
              >
                {prompt ? "Save Changes" : "Create Prompt"}
              </Button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
