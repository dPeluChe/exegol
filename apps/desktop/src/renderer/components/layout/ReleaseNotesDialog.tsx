import { cn } from "@exegol/ui";
import * as Dialog from "@radix-ui/react-dialog";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronRight, X } from "lucide-react";
import { type ReactNode, useMemo, useState } from "react";
import {
  countByKind,
  filterSections,
  NOTES_KINDS,
  type NotesFilter,
  type NotesKind,
  noteExpands,
  noteHeadline,
  parseReleaseNotes,
} from "../../lib/release-notes";
import { SEMANTIC_BADGE } from "../../lib/semantic-colors";
import { trpcInvoke, trpcMutate } from "../../lib/trpc-client";

interface ReleaseNote {
  version: string;
  date: string | null;
  body: string;
}

/** `code` in a note reads as code; the rest is plain text */
function NoteText({ text }: { text: string }) {
  let offset = 0;
  const parts = text.split(/(`[^`]+`)/).map((part) => {
    const at = offset;
    offset += part.length;
    return { part, at };
  });
  return (
    <>
      {parts.map(({ part, at }) =>
        part.startsWith("`") && part.endsWith("`") ? (
          <code key={at} className="rounded bg-white/10 px-1 font-mono text-[10px]">
            {part.slice(1, -1)}
          </code>
        ) : (
          <span key={at}>{part}</span>
        ),
      )}
    </>
  );
}

function formatDate(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? null
    : d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

const KIND_STYLE: Record<NotesKind, { label: string; badge: string }> = {
  added: { label: "Added", badge: SEMANTIC_BADGE.success },
  changed: { label: "Changed", badge: SEMANTIC_BADGE.info },
  fixed: { label: "Fixed", badge: SEMANTIC_BADGE.warning },
};

function FilterChip({
  active,
  badge,
  onClick,
  children,
}: {
  active: boolean;
  badge: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "rounded-full px-2 py-0.5 text-[10px] font-medium transition-opacity",
        badge,
        active ? "ring-1 ring-current" : "opacity-60 hover:opacity-100",
      )}
    >
      {children}
    </button>
  );
}

function NoteEntry({
  text,
  open,
  onToggle,
}: {
  text: string;
  open: boolean;
  onToggle: () => void;
}) {
  const headline = noteHeadline(text);
  if (!noteExpands(text, headline)) {
    return (
      <li>
        <NoteText text={text} />
      </li>
    );
  }
  return (
    <li>
      <button
        type="button"
        aria-expanded={open}
        aria-label={open ? "Collapse" : "Expand"}
        onClick={onToggle}
        className="flex w-full items-start gap-1 rounded text-left hover:text-text-primary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent"
      >
        <span className={cn("min-w-0 flex-1", !open && "truncate")}>
          <NoteText text={open ? text : headline} />
        </span>
        <ChevronRight
          aria-hidden
          className={cn(
            "mt-0.5 h-3 w-3 shrink-0 text-text-muted transition-transform",
            open && "rotate-90",
          )}
        />
      </button>
    </li>
  );
}

/** Newest first: the newest open, the ones before it folded (a user who skipped versions sees
 *  them all, but the latest is what they came for) */
function NotesList({ notes }: { notes: ReleaseNote[] }) {
  const [filter, setFilter] = useState<NotesFilter>("all");
  const [expandAll, setExpandAll] = useState(false);
  const [toggled, setToggled] = useState<ReadonlySet<string>>(new Set());
  const { parsed, totals } = useMemo(() => {
    const parsed = notes.map((note) => {
      const sections = parseReleaseNotes(note.body);
      return { note, sections, counts: countByKind(sections) };
    });
    return { parsed, totals: countByKind(parsed.flatMap((p) => p.sections)) };
  }, [notes]);
  const toggle = (key: string) =>
    setToggled((prev) => {
      const next = new Set(prev);
      if (!next.delete(key)) next.add(key);
      return next;
    });
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-1.5">
        <FilterChip
          active={filter === "all"}
          badge={SEMANTIC_BADGE.muted}
          onClick={() => setFilter("all")}
        >
          All
        </FilterChip>
        {NOTES_KINDS.filter((kind) => totals[kind] > 0).map((kind) => (
          <FilterChip
            key={kind}
            active={filter === kind}
            badge={KIND_STYLE[kind].badge}
            onClick={() => setFilter(kind)}
          >
            {KIND_STYLE[kind].label} {totals[kind]}
          </FilterChip>
        ))}
        <button
          type="button"
          aria-pressed={expandAll}
          onClick={() => {
            setExpandAll((v) => !v);
            setToggled(new Set());
          }}
          className="ml-auto text-[10px] text-text-muted hover:text-text-primary"
        >
          {expandAll ? "Collapse all" : "Expand all"}
        </button>
      </div>
      {parsed.map(({ note, sections, counts }, i) => {
        const shown = filterSections(sections, filter);
        const count = shown.reduce((n, s) => n + s.items.length, 0);
        return (
          <details key={note.version} open={i === 0} className="group">
            <summary className="mb-1 flex cursor-pointer list-none items-baseline gap-2 text-xs font-semibold text-text-primary">
              <ChevronRight className="h-3 w-3 shrink-0 self-center text-text-muted transition-transform group-open:rotate-90" />
              v{note.version}
              {formatDate(note.date) && (
                <span className="text-[10px] font-normal text-text-muted">
                  {formatDate(note.date)}
                </span>
              )}
              {notes.length > 1 &&
                NOTES_KINDS.filter((kind) => counts[kind] > 0).map((kind) => (
                  <span
                    key={kind}
                    className={cn(
                      "rounded-full px-1.5 text-[9px] font-medium",
                      KIND_STYLE[kind].badge,
                    )}
                  >
                    {KIND_STYLE[kind].label} {counts[kind]}
                  </span>
                ))}
              <span className="text-[10px] font-normal text-text-muted group-open:hidden">
                {count} {count === 1 ? "change" : "changes"}
              </span>
            </summary>
            {shown.length === 0 && (
              <p className="pl-5 text-[11px] text-text-muted">Nothing of this kind.</p>
            )}
            {shown.map((section) => (
              <div key={section.title ?? "intro"} className="mb-2 pl-5">
                {section.title && (
                  <p className="mb-0.5 text-[10px] uppercase tracking-wider text-text-muted">
                    {section.title}
                  </p>
                )}
                <ul className="list-disc space-y-0.5 pl-4 text-[11px] text-text-secondary">
                  {section.items.map((item, j) => {
                    const key = `${note.version}:${section.title}:${j}`;
                    return (
                      <NoteEntry
                        key={key}
                        text={item}
                        open={expandAll !== toggled.has(key)}
                        onToggle={() => toggle(key)}
                      />
                    );
                  })}
                </ul>
              </div>
            ))}
          </details>
        );
      })}
    </div>
  );
}

/** What's in one or more releases: the notes GitHub publishes for each version */
export function ReleaseNotesDialog({
  open,
  onOpenChange,
  title,
  notes,
  loading,
  footer,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  notes: ReleaseNote[];
  loading: boolean;
  footer?: ReactNode;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50" />
        <Dialog.Content className="fixed left-1/2 top-[10%] z-50 flex max-h-[80vh] w-full max-w-lg -translate-x-1/2 flex-col gap-3 rounded-xl border border-border bg-bg-secondary p-4 shadow-2xl">
          <div className="flex items-center justify-between">
            <Dialog.Title className="text-sm font-semibold text-text-primary">{title}</Dialog.Title>
            <Dialog.Close
              aria-label="Close"
              className="rounded p-1 text-text-muted hover:bg-white/10"
            >
              <X className="h-3.5 w-3.5" />
            </Dialog.Close>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto pr-1">
            {loading ? (
              <p className="text-[11px] text-text-muted">Loading release notes...</p>
            ) : notes.length === 0 ? (
              <p className="text-[11px] text-text-muted">
                Release notes are not available right now (offline or GitHub unreachable).
              </p>
            ) : (
              <NotesList notes={notes} />
            )}
          </div>
          {footer && <div className="flex justify-end gap-2">{footer}</div>}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/** The notes between the running version and `version` (the one the updater found) */
export function useUpdateNotes(version: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: ["updates", "notes", version],
    queryFn: () => trpcInvoke<ReleaseNote[]>("updates.notes", { to: version }),
    enabled: enabled && !!version,
    staleTime: 10 * 60 * 1000,
  });
}

/** Once after an update is installed: what changed since the version the user last ran */
export function WhatsNewAfterUpdate() {
  const { data } = useQuery({
    queryKey: ["updates", "whatsNew"],
    queryFn: () => trpcInvoke<{ version: string; notes: ReleaseNote[] } | null>("updates.whatsNew"),
    staleTime: Number.POSITIVE_INFINITY,
  });
  const queryClient = useQueryClient();
  const markSeen = useMutation({
    mutationFn: () => trpcMutate("updates.markSeen"),
    // Seen: the cached answer is now "nothing new", which closes the dialog
    onSuccess: () => queryClient.setQueryData(["updates", "whatsNew"], null),
  });
  // No notes (offline): nothing to show, and it is asked again on the next launch
  const open = !!data && data.notes.length > 0;
  return (
    <ReleaseNotesDialog
      open={open}
      onOpenChange={(next) => {
        if (!next) markSeen.mutate();
      }}
      title={`What's new in Exegol ${data?.version ?? ""}`}
      notes={data?.notes ?? []}
      loading={false}
    />
  );
}
