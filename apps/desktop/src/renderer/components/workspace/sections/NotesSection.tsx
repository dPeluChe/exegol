import {
  groupNotes,
  NOTES_PER_FOLDER,
  type Note,
  type NotesPlace,
  noteMatches,
} from "@exegol/shared";
import { Button, cn } from "@exegol/ui";
import { FolderOpen, NotebookPen, Plus } from "lucide-react";
import { useState } from "react";
import { useProjectContext } from "../../../contexts/ProjectContext";
import { useAct } from "../../../hooks/use-act";
import { useColabs } from "../../../hooks/use-inbox";
import { useNotes } from "../../../hooks/use-notes";
import { INPUT_CLASS } from "../../agents/SpawnOptions";
import { EmptyState } from "../../common/EmptyState";
import { FilterChip } from "../../common/FilterChip";
import { NoteEditor, NoteView } from "./NoteView";

type Panel = { kind: "none" } | { kind: "note"; id: string } | { kind: "edit"; id: string | null };

const NONE: Panel = { kind: "none" };

function NoteList({
  notes,
  selected,
  onPick,
}: {
  notes: Note[];
  selected: string | null;
  onPick: (id: string) => void;
}) {
  return (
    <div className="space-y-3">
      {groupNotes(notes).map(([group, list]) => (
        <section key={group}>
          <h4 className="px-1 pb-1 text-[10px] uppercase tracking-wide text-text-muted">{group}</h4>
          {list.map((n) => (
            <button
              key={n.id}
              type="button"
              onClick={() => onPick(n.id)}
              className={cn(
                "block w-full truncate rounded-md px-2 py-1 text-left text-xs",
                n.id === selected
                  ? "bg-white/10 text-text-primary"
                  : "text-text-secondary hover:bg-white/5",
              )}
              title={n.title}
            >
              {n.title}
              <span className="ml-2 text-[10px] text-text-muted">{n.date.slice(0, 10)}</span>
            </button>
          ))}
        </section>
      ))}
    </div>
  );
}

function PlaceNotes({ place }: { place: NotesPlace }) {
  const [retired, setRetired] = useState(false);
  const { data } = useNotes(place, retired);
  const { act } = useAct("Folder not opened");
  const [query, setQuery] = useState("");
  const [panel, setPanel] = useState<Panel>(NONE);
  const pool = data?.notes ?? [];
  const q = query.trim().toLowerCase();
  const shown = q ? pool.filter((n) => noteMatches(n, q)) : pool;
  const current = panel.kind === "none" ? null : (pool.find((n) => n.id === panel.id) ?? null);
  const back = (id: string | null) => setPanel(id ? { kind: "note", id } : NONE);

  return (
    <div className="flex min-h-0 flex-1">
      <aside className="flex w-72 shrink-0 flex-col gap-2 border-r border-border p-2">
        <div className="flex items-center gap-1">
          <FilterChip
            active={!retired}
            onClick={() => {
              setRetired(false);
              setPanel(NONE);
            }}
          >
            Active {data?.active ?? 0}/{NOTES_PER_FOLDER}
          </FilterChip>
          <FilterChip
            active={retired}
            onClick={() => {
              setRetired(true);
              setPanel(NONE);
            }}
          >
            Retired {data?.retired ?? 0}
          </FilterChip>
          <span className="flex-1" />
          <Button size="sm" variant="ghost" onClick={() => setPanel({ kind: "edit", id: null })}>
            <Plus className="h-3.5 w-3.5" />
            New
          </Button>
        </div>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search notes"
          className={INPUT_CLASS}
        />
        <div className="min-h-0 flex-1 overflow-y-auto">
          {shown.length > 0 ? (
            <NoteList
              notes={shown}
              selected={current?.id ?? null}
              onPick={(id) => setPanel({ kind: "note", id })}
            />
          ) : (
            <p className="px-1 text-[11px] text-text-muted">
              {q ? "No note matches." : retired ? "Nothing retired." : "No notes yet."}
            </p>
          )}
        </div>
        {data?.folder && (
          <button
            type="button"
            onClick={() => void act("notes.openFolder", { place })}
            className="flex items-center gap-1 truncate text-left text-[10px] text-text-muted hover:text-text-secondary"
            title="Open the folder"
          >
            <FolderOpen className="h-3 w-3 shrink-0" />
            {data.folder}
          </button>
        )}
      </aside>
      <div className="min-w-0 flex-1">
        {panel.kind === "edit" ? (
          <NoteEditor key={panel.id ?? "new"} place={place} note={current} onDone={back} />
        ) : current ? (
          <NoteView
            key={current.id}
            place={place}
            note={current}
            onEdit={() => setPanel({ kind: "edit", id: current.id })}
            onGone={() => setPanel(NONE)}
          />
        ) : (
          <div className="flex h-full items-center justify-center p-6">
            <EmptyState
              icon={<NotebookPen className="h-8 w-8 text-text-muted" />}
              title="Notes"
              description="Decisions, reminders and what was tried: what a later session should know that the code and docs cannot show. Agents write them with the note_ tools; you can add, edit and retire them here."
            />
          </div>
        )}
      </div>
    </div>
  );
}

export function NotesSection() {
  const { projectId } = useProjectContext();
  const colabs = useColabs().filter((c) => c.members.some((m) => m.projectId === projectId));
  const [scope, setScope] = useState<string>("project");
  if (!projectId) return null;
  const colab = colabs.find((c) => c.id === scope);
  const place: NotesPlace =
    scope === "personal"
      ? { scope: "personal" }
      : colab
        ? { scope: "colab", colabId: colab.id }
        : { scope: "project", projectId };
  const active = place.scope === "colab" ? place.colabId : place.scope;

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-10 shrink-0 items-center gap-1 border-b border-border bg-bg-secondary px-3">
        <NotebookPen className="mr-1 h-4 w-4 text-text-muted" />
        <FilterChip active={active === "project"} onClick={() => setScope("project")}>
          Project
        </FilterChip>
        {colabs.map((c) => (
          <FilterChip key={c.id} active={active === c.id} onClick={() => setScope(c.id)}>
            {c.name}
          </FilterChip>
        ))}
        <FilterChip active={active === "personal"} onClick={() => setScope("personal")}>
          Personal
        </FilterChip>
      </div>
      <PlaceNotes key={`${projectId}:${active}`} place={place} />
    </div>
  );
}
