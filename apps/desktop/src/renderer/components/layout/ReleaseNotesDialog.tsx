import * as Dialog from "@radix-ui/react-dialog";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { X } from "lucide-react";
import type { ReactNode } from "react";
import { parseReleaseNotes } from "../../lib/release-notes";
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

function NotesList({ notes }: { notes: ReleaseNote[] }) {
  return (
    <div className="space-y-4">
      {notes.map((note) => (
        <section key={note.version}>
          <h3 className="mb-1 flex items-baseline gap-2 text-xs font-semibold text-text-primary">
            v{note.version}
            {formatDate(note.date) && (
              <span className="text-[10px] font-normal text-text-muted">
                {formatDate(note.date)}
              </span>
            )}
          </h3>
          {parseReleaseNotes(note.body).map((section) => (
            <div key={section.title ?? "intro"} className="mb-2">
              {section.title && (
                <p className="mb-0.5 text-[10px] uppercase tracking-wider text-text-muted">
                  {section.title}
                </p>
              )}
              <ul className="list-disc space-y-0.5 pl-4 text-[11px] text-text-secondary">
                {section.items.map((item) => (
                  <li key={item}>
                    <NoteText text={item} />
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </section>
      ))}
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
