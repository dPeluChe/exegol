import { type Colab, INBOX_BODY_MAX, INBOX_TITLE_MAX } from "@exegol/shared";
import { Button } from "@exegol/ui";
import { useState } from "react";
import { useAct } from "../../hooks/use-act";
import type { InboxTarget as Target } from "../../lib/inbox-menu";
import { INPUT_CLASS } from "../agents/SpawnOptions";
import { FilterChip } from "../common/FilterChip";
import type { ProjectMeta } from "../common/ProjectChip";
import { SessionSelect } from "./SessionSelect";

/** A thread the person opens. With a project: in its inbox, one of its colabs or Personal;
 *  without one, in the colab it starts on */
export function NewThread({
  project,
  colabs,
  meta,
  start,
  onOpened,
}: {
  project: { id: string; name: string } | null;
  colabs: Colab[];
  meta: ReadonlyMap<string, ProjectMeta>;
  start: Target;
  onOpened: (id: string) => void;
}) {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [target, setTarget] = useState<Target>(start);
  const [session, setSession] = useState<string | null>(null);
  const { busy, act } = useAct("Thread not opened");
  const colab = target.kind === "colab" ? colabs.find((c) => c.id === target.id) : undefined;
  const memberIds = [...new Set(colab?.members.map((m) => m.projectId))];
  const forProject =
    target.kind === "project" ? (project?.id ?? null) : target.kind === "colab" ? target.to : null;
  const pick = (next: Target) => {
    setTarget(next);
    setSession(null);
  };

  const post = async () => {
    const opened = await act<{ id: string }>("inbox.open", {
      title,
      body,
      projectId: target.kind === "project" ? (project?.id ?? null) : null,
      ...(target.kind === "colab" && { colabId: target.id, toProject: target.to }),
      toSession: forProject ? session : null,
    });
    if (opened) onOpened(opened.value.id);
  };

  return (
    <div className="flex flex-col gap-2 p-2">
      {project && (
        <div className="flex flex-wrap items-center gap-1">
          <FilterChip active={target.kind === "project"} onClick={() => pick({ kind: "project" })}>
            {project.name}
          </FilterChip>
          {colabs.map((c) => (
            <FilterChip
              key={c.id}
              active={colab?.id === c.id}
              onClick={() => pick({ kind: "colab", id: c.id, to: null })}
            >
              {c.name}
            </FilterChip>
          ))}
          <FilterChip
            active={target.kind === "personal"}
            onClick={() => pick({ kind: "personal" })}
          >
            Personal
          </FilterChip>
        </div>
      )}
      {colab && (
        <select
          value={target.kind === "colab" ? (target.to ?? "") : ""}
          onChange={(e) => pick({ kind: "colab", id: colab.id, to: e.target.value || null })}
          aria-label="Member it is for"
          className={INPUT_CLASS}
        >
          <option value="">For the whole colab</option>
          {memberIds.map((id) => (
            <option key={id} value={id}>
              For {meta.get(id)?.name ?? id}
            </option>
          ))}
        </select>
      )}
      {forProject && (
        <SessionSelect
          key={forProject}
          projectId={forProject}
          value={session}
          onChange={setSession}
          any="For any session there"
          prefix="For "
          className={INPUT_CLASS}
        />
      )}
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        maxLength={INBOX_TITLE_MAX}
        placeholder="Title"
        className={INPUT_CLASS}
      />
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={6}
        maxLength={INBOX_BODY_MAX}
        placeholder="What should a session know"
        className={INPUT_CLASS}
      />
      <Button
        size="sm"
        className="self-end"
        disabled={busy || !title.trim() || !body.trim()}
        onClick={() => void post()}
      >
        Open thread
      </Button>
    </div>
  );
}
