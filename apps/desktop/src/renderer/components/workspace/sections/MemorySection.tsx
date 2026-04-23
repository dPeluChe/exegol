import type { MemoryEntry } from "@exegol/shared";
import { Badge, Button, cn } from "@exegol/ui";
import * as Dialog from "@radix-ui/react-dialog";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Brain, Plus, Search, Trash2, X } from "lucide-react";
import { useRef, useState } from "react";
import { useProjectContext } from "../../../contexts/ProjectContext";
import {
  useCreateMemory,
  useDeleteMemory,
  useMemories,
  useSearchMemories,
} from "../../../hooks/use-trpc-memory";
import { ConfirmDialog } from "../../common/ConfirmDialog";
import { EmptyState } from "../../common/EmptyState";

// ─── Constants ───────────────────────────────────────────────────────────────

const CATEGORIES = [
  { id: "all", label: "All" },
  { id: "preference", label: "Preference" },
  { id: "pattern", label: "Pattern" },
  { id: "error", label: "Error" },
  { id: "solution", label: "Solution" },
  { id: "dependency", label: "Dependency" },
  { id: "convention", label: "Convention" },
] as const;

const CATEGORY_COLORS: Record<string, string> = {
  preference: "bg-blue-500/20 text-blue-400",
  pattern: "bg-purple-500/20 text-purple-400",
  error: "bg-red-500/20 text-red-400",
  solution: "bg-green-500/20 text-green-400",
  dependency: "bg-amber-500/20 text-amber-400",
  convention: "bg-cyan-500/20 text-cyan-400",
};

// ─── Main component ──────────────────────────────────────────────────────────

export function MemorySection() {
  const { projectId } = useProjectContext();
  const [filterCategory, setFilterCategory] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const categoryParam = filterCategory === "all" ? undefined : filterCategory;
  const { data: memories } = useMemories(projectId, categoryParam);
  const { data: searchResults } = useSearchMemories(
    projectId,
    searchQuery.length >= 2 ? searchQuery : "",
  );

  const displayMemories = searchQuery.length >= 2 ? searchResults : memories;
  const items = displayMemories ?? [];

  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 72,
    overscan: 5,
    measureElement: (el) => el.getBoundingClientRect().height,
  });

  return (
    <div className="flex h-full flex-col">
      {/* Top bar */}
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border bg-bg-secondary px-3">
        <Brain className="h-4 w-4 text-text-muted" />
        <span className="text-xs font-medium text-text-primary">Memory</span>

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

        <div className="ml-auto flex items-center gap-2">
          {/* Search */}
          <div className="relative">
            <Search className="absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-text-muted" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search..."
              className="h-7 w-40 rounded border border-border bg-bg-tertiary pl-7 pr-2 text-[11px] text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-accent"
            />
          </div>

          <Button
            type="button"
            onClick={() => setDialogOpen(true)}
            className="h-7 gap-1.5 bg-accent px-2 text-[11px] text-white"
          >
            <Plus className="h-3 w-3" />
            Add
          </Button>
        </div>
      </div>

      {/* Content */}
      {!displayMemories || displayMemories.length === 0 ? (
        <div className="flex h-full items-center justify-center">
          <EmptyState
            icon={<Brain className="h-8 w-8 text-text-muted" />}
            title={searchQuery ? "No results found" : "No memories yet"}
            description={
              searchQuery
                ? "Try a different search term."
                : "Memories are automatically extracted from agent sessions. You can also add them manually."
            }
            action={
              searchQuery ? undefined : { label: "Add Memory", onClick: () => setDialogOpen(true) }
            }
          />
        </div>
      ) : (
        <div ref={scrollRef} className="flex-1 overflow-y-auto">
          <div
            style={{ height: `${virtualizer.getTotalSize()}px`, position: "relative" }}
            className="p-3"
          >
            {virtualizer.getVirtualItems().map((vItem) => (
              <div
                key={vItem.key}
                data-index={vItem.index}
                ref={virtualizer.measureElement}
                style={{
                  position: "absolute",
                  top: 0,
                  transform: `translateY(${vItem.start}px)`,
                  width: "calc(100% - 1.5rem)",
                  paddingBottom: "0.375rem",
                }}
              >
                {items[vItem.index] && <MemoryCard memory={items[vItem.index] as MemoryEntry} />}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Create dialog */}
      <CreateMemoryDialog open={dialogOpen} onOpenChange={setDialogOpen} projectId={projectId} />
    </div>
  );
}

// ─── Memory card ─────────────────────────────────────────────────────────────

function MemoryCard({ memory }: { memory: MemoryEntry }) {
  const deleteMemory = useDeleteMemory();
  const [confirmDelete, setConfirmDelete] = useState(false);

  const relativeTime = getRelativeTime(memory.createdAt);
  const colorClass = CATEGORY_COLORS[memory.category] ?? "bg-zinc-500/20 text-zinc-400";

  return (
    <div className="group flex items-start gap-2 rounded-lg border border-border bg-bg-secondary p-2.5">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <Badge className={cn("text-[9px]", colorClass)}>{memory.category}</Badge>
          <span className="text-[9px] text-text-muted">{relativeTime}</span>
          {memory.accessCount > 0 && (
            <span className="text-[9px] text-text-muted">used {memory.accessCount}x</span>
          )}
          <span className="text-[9px] text-text-muted">
            score: {memory.relevanceScore.toFixed(1)}
          </span>
        </div>
        <p className="text-[11px] text-text-primary whitespace-pre-wrap break-words">
          {memory.content}
        </p>
      </div>

      <button
        type="button"
        onClick={() => setConfirmDelete(true)}
        className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-text-muted opacity-0 transition-all hover:text-error group-hover:opacity-100"
      >
        <Trash2 className="h-3 w-3" />
      </button>

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Delete Memory"
        description="Are you sure you want to delete this memory? This cannot be undone."
        confirmLabel="Delete"
        variant="destructive"
        onConfirm={() => deleteMemory.mutate(memory.id)}
      />
    </div>
  );
}

// ─── Create dialog ───────────────────────────────────────────────────────────

function CreateMemoryDialog({
  open,
  onOpenChange,
  projectId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string | null;
}) {
  const createMemory = useCreateMemory();
  const [content, setContent] = useState("");
  const [category, setCategory] = useState("convention");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!content.trim() || !projectId) return;

    await createMemory.mutateAsync({
      projectId,
      category,
      content: content.trim(),
      relevanceScore: 0.7,
    });
    setContent("");
    onOpenChange(false);
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/60" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-lg border border-border bg-bg-secondary p-6 shadow-2xl">
          <div className="mb-4 flex items-center justify-between">
            <Dialog.Title className="text-base font-semibold text-text-primary">
              Add Memory
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
              <div className="text-xs font-medium text-text-secondary">Category</div>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="flex h-9 w-full rounded-md border border-border bg-bg-tertiary px-3 py-1 text-sm text-text-primary transition-colors focus:outline-none focus:ring-1"
              >
                <option value="preference">Preference</option>
                <option value="pattern">Pattern</option>
                <option value="error">Error</option>
                <option value="solution">Solution</option>
                <option value="dependency">Dependency</option>
                <option value="convention">Convention</option>
              </select>
            </div>

            <div className="space-y-1.5">
              <div className="text-xs font-medium text-text-secondary">Content</div>
              <textarea
                value={content}
                onChange={(e) => setContent(e.target.value)}
                placeholder="What should agents remember about this project?"
                rows={4}
                className="flex w-full rounded-md border border-border bg-bg-tertiary px-3 py-2 text-sm text-text-primary transition-colors placeholder:text-zinc-600 focus:outline-none focus:ring-1"
                style={{ resize: "vertical" }}
              />
            </div>

            <div className="flex justify-end pt-2">
              <Button
                type="submit"
                disabled={!content.trim()}
                className="gap-2 bg-accent text-white"
              >
                Add Memory
              </Button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getRelativeTime(unixSeconds: number): string {
  const now = Math.floor(Date.now() / 1000);
  const diff = now - unixSeconds;

  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;
  return new Date(unixSeconds * 1000).toLocaleDateString();
}
