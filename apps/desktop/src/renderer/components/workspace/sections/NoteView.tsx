import {
  NOTE_BODY_MAX,
  NOTE_GROUP_MAX,
  NOTE_TITLE_MAX,
  type Note,
  type NotesPlace,
} from "@exegol/shared";
import { Button, cn } from "@exegol/ui";
import { useState } from "react";
import { useAct } from "../../../hooks/use-act";

import { sessionName } from "../../../lib/agent-label";
import { useAgentStore } from "../../../stores/agents";
import { INPUT_CLASS } from "../../agents/SpawnOptions";
import { ConfirmDialog } from "../../common/ConfirmDialog";
import { ChatMarkdown } from "./ChatMarkdown";

function byline(note: Note, name: string | null): string {
  const who = note.session ? [name, note.cli].filter(Boolean).join(", ") || "Agent" : "You";
  const where = note.branch && note.commit ? `${note.branch} @ ${note.commit}` : note.commit;
  return [note.group, new Date(note.date).toLocaleString(), who, where].filter(Boolean).join(" · ");
}

export function NoteEditor({
  place,
  note,
  draft,
  onDone,
}: {
  place: NotesPlace;
  note: Note | null;
  /** A new note started from something else, like an inbox thread */
  draft?: Pick<Note, "title" | "body">;
  onDone: (id: string | null) => void;
}) {
  const { busy, act } = useAct("Note not saved");
  const start = note ?? draft;
  const [title, setTitle] = useState(start?.title ?? "");
  const [group, setGroup] = useState(note?.group ?? "");
  const [body, setBody] = useState(start?.body ?? "");

  const save = async () => {
    const saved = await act<Note>("notes.save", { place, id: note?.id, title, body, group });
    if (saved) onDone(saved.value.id);
  };

  return (
    <div className="flex h-full flex-col gap-2 p-3">
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        maxLength={NOTE_TITLE_MAX}
        placeholder="Title"
        className={INPUT_CLASS}
      />
      <input
        value={group}
        onChange={(e) => setGroup(e.target.value)}
        maxLength={NOTE_GROUP_MAX}
        placeholder="Group: Decisions, Gotchas (General if empty)"
        className={INPUT_CLASS}
      />
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        maxLength={NOTE_BODY_MAX}
        placeholder="What a later session should know that the code and docs cannot show"
        className={cn(INPUT_CLASS, "min-h-40 flex-1 resize-none font-mono")}
      />
      <div className="flex items-center gap-2">
        <span className="text-[10px] text-text-muted">
          {body.length} / {NOTE_BODY_MAX}
        </span>
        <span className="flex-1" />
        <Button size="sm" variant="ghost" onClick={() => onDone(note?.id ?? null)}>
          Cancel
        </Button>
        <Button size="sm" disabled={busy || !title.trim() || !body.trim()} onClick={save}>
          Save
        </Button>
      </div>
    </div>
  );
}

export function NoteView({
  place,
  note,
  onEdit,
  onGone,
}: {
  place: NotesPlace;
  note: Note;
  onEdit: () => void;
  onGone: () => void;
}) {
  const { busy, act } = useAct("Not done");
  const [reason, setReason] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const name = useAgentStore((s) => {
    const session = note.session ? s.agents[note.session] : undefined;
    return session ? sessionName(session) : null;
  });
  const run = async (path: string, extra: object = {}) => {
    if (await act(path, { place, id: note.id, ...extra })) onGone();
  };

  return (
    <div className="flex h-full flex-col">
      <header className="shrink-0 space-y-1 border-b border-border px-3 py-2">
        <h3 className="text-sm font-medium text-text-primary">{note.title}</h3>
        <p className="text-[10px] text-text-muted">{byline(note, name)}</p>
        {note.retiredReason && (
          <p className="text-[10px] text-warning">Retired: {note.retiredReason}</p>
        )}
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2 text-xs text-text-secondary">
        <ChatMarkdown text={note.body} />
      </div>
      <footer className="flex shrink-0 flex-wrap items-center gap-2 border-t border-border px-3 py-2">
        {note.retiredAt ? (
          <>
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => run("notes.restore")}>
              Restore
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(true)}>
              Delete
            </Button>
          </>
        ) : reason === null ? (
          <>
            <Button size="sm" variant="ghost" onClick={onEdit}>
              Edit
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setReason("")}>
              Retire
            </Button>
          </>
        ) : (
          <>
            <input
              // biome-ignore lint/a11y/noAutofocus: opened by the Retire button to type the reason
              autoFocus
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && reason.trim()) void run("notes.retire", { reason });
                if (e.key === "Escape") setReason(null);
              }}
              placeholder="Why: wrong, fixed, no longer true"
              className={cn(INPUT_CLASS, "w-72")}
            />
            <Button
              size="sm"
              disabled={busy || !reason.trim()}
              onClick={() => run("notes.retire", { reason })}
            >
              Retire
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setReason(null)}>
              Cancel
            </Button>
          </>
        )}
      </footer>
      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Delete this note?"
        description="The file is removed; a retired note cannot come back after this."
        confirmLabel="Delete"
        variant="destructive"
        onConfirm={() => void run("notes.delete")}
      />
    </div>
  );
}
