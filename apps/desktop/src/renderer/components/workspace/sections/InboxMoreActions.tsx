import {
  type Colab,
  type InboxThread,
  inboxProjectOf,
  isInboxClosed,
  NOTE_BODY_MAX,
  type NotesPlace,
} from "@exegol/shared";
import { Button, cn } from "@exegol/ui";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useAct } from "../../../hooks/use-act";
import { useColabs } from "../../../hooks/use-inbox";
import { openInBrowser } from "../../../lib/open-in-browser";
import { trpcInvoke } from "../../../lib/trpc-client";
import { useToastStore } from "../../../stores/toasts";
import { INPUT_CLASS } from "../../agents/SpawnOptions";
import { FilterChip } from "../../common/FilterChip";
import type { ProjectMeta } from "../../common/ProjectChip";
import { NoteEditor } from "./NoteView";

export function useThreadAct(id: string) {
  const { busy, act } = useAct(`${id}: not done`);
  return { busy, act: <T,>(path: string, input: object) => act<T>(path, { id, ...input }) };
}

type Panel = "forward" | "note" | "issue" | null;

const CHIP = "border border-border text-[11px] text-text-primary";

/** One select over every place a thread can go, encoded as its value */
export function inboxTargets(
  thread: InboxThread | null,
  projectMeta: ReadonlyMap<string, ProjectMeta>,
  colabs: Colab[],
) {
  const here = !thread
    ? null
    : thread.scope === "project"
      ? `p:${thread.scopeId}`
      : thread.scope === "colab"
        ? `c:${thread.scopeId}:${thread.toProject ?? ""}`
        : "personal";
  const all = [
    ...[...projectMeta].map(([id, m]) => ({ value: `p:${id}`, label: m.name })),
    ...colabs.flatMap((c) => [
      { value: `c:${c.id}:`, label: `${c.name} (all)` },
      ...[...new Map(c.members.map((m) => [m.projectId, m.projectName]))].map(([id, name]) => ({
        value: `c:${c.id}:${id}`,
        label: `${c.name} > ${name}`,
      })),
    ]),
    { value: "personal", label: "Personal" },
  ];
  return all.filter((t) => t.value !== here);
}

export function inboxTargetOf(value: string) {
  if (value === "personal") return { scope: "personal" };
  const [kind, id, to] = value.split(":");
  return kind === "p"
    ? { scope: "project", projectId: id }
    : { scope: "colab", colabId: id, toProject: to || null };
}

function Forward({
  thread,
  projectMeta,
  onOpen,
}: {
  thread: InboxThread;
  projectMeta: ReadonlyMap<string, ProjectMeta>;
  onOpen: (id: string) => void;
}) {
  const colabs = useColabs();
  const { busy, act } = useThreadAct(thread.id);
  const [to, setTo] = useState("");
  const send = async () => {
    const done = await act<{ id: string }>("inbox.forward", { target: inboxTargetOf(to) });
    if (done) onOpen(done.value.id);
  };
  return (
    <div className="flex items-center gap-1.5">
      <select value={to} onChange={(e) => setTo(e.target.value)} className={INPUT_CLASS}>
        <option value="">Forward to</option>
        {inboxTargets(thread, projectMeta, colabs).map((t) => (
          <option key={t.value} value={t.value}>
            {t.label}
          </option>
        ))}
      </select>
      <Button size="sm" disabled={busy || !to} onClick={() => void send()}>
        Forward
      </Button>
    </div>
  );
}

function SaveAsNote({
  thread,
  lastBody,
  onDone,
}: {
  thread: InboxThread;
  lastBody: string;
  onDone: () => void;
}) {
  const project = inboxProjectOf(thread);
  const places = new Map<string, NotesPlace>();
  if (project) places.set("Project", { scope: "project", projectId: project });
  if (thread.scope === "colab" && thread.scopeId) {
    places.set("Colab", { scope: "colab", colabId: thread.scopeId });
  }
  places.set("Personal", { scope: "personal" });
  const [pick, setPick] = useState(places.keys().next().value ?? "Personal");
  const place = places.get(pick) ?? { scope: "personal" };
  const last = thread.resolution ?? lastBody;
  return (
    <div className="flex h-72 flex-col rounded-lg border border-border">
      <div className="flex gap-1 px-3 pt-2">
        {[...places.keys()].map((label) => (
          <FilterChip key={label} active={label === pick} onClick={() => setPick(label)}>
            {label}
          </FilterChip>
        ))}
      </div>
      <div className="min-h-0 flex-1">
        <NoteEditor
          key={pick}
          place={place}
          note={null}
          draft={{ title: thread.title, body: last.slice(0, NOTE_BODY_MAX) }}
          onDone={(id) => {
            if (id) useToastStore.getState().addToast({ type: "success", title: "Saved as note" });
            onDone();
          }}
        />
      </div>
    </div>
  );
}

interface Draft {
  repos: string[];
  title: string;
  body: string;
}

function SendAsIssue({ thread, onDone }: { thread: InboxThread; onDone: () => void }) {
  const { data, error } = useQuery({
    queryKey: ["issue-draft", thread.id],
    queryFn: () => trpcInvoke<Draft>("inbox.issueDraft", { id: thread.id }),
    staleTime: Number.POSITIVE_INFINITY,
  });
  if (error) return <p className="text-[11px] text-warning">{String(error.message)}</p>;
  if (!data) return null;
  if (data.repos.length === 0) {
    return <p className="text-[11px] text-text-muted">This project has no GitHub repo.</p>;
  }
  return <IssueForm thread={thread} draft={data} onDone={onDone} />;
}

function IssueForm({
  thread,
  draft,
  onDone,
}: {
  thread: InboxThread;
  draft: Draft;
  onDone: () => void;
}) {
  const { busy, act } = useThreadAct(thread.id);
  const [repo, setRepo] = useState(draft.repos[0] ?? "");
  const [title, setTitle] = useState(draft.title);
  const [body, setBody] = useState(draft.body);
  const send = async () => {
    const sent = await act<{ url: string }>("inbox.sendAsIssue", { repo, title, body });
    if (!sent) return;
    openInBrowser(sent.value.url);
    onDone();
  };
  return (
    <div className="flex flex-col gap-1.5">
      <p className="text-[10px] text-warning">
        Anyone who can see {repo || "the repo"} reads this: check the text before sending.
      </p>
      <div className="flex gap-1.5">
        {draft.repos.length > 1 && (
          <select value={repo} onChange={(e) => setRepo(e.target.value)} className={INPUT_CLASS}>
            {draft.repos.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        )}
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className={cn(INPUT_CLASS, "min-w-0 flex-1")}
        />
      </div>
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={8}
        className={cn(INPUT_CLASS, "resize-y font-mono")}
      />
      <div className="flex justify-end">
        <Button
          size="sm"
          disabled={busy || !title.trim() || !body.trim()}
          onClick={() => void send()}
        >
          Create issue
        </Button>
      </div>
    </div>
  );
}

/** Forward, Save as note, Send as issue: a person's actions, each folded behind its chip */
export function InboxMoreActions({
  thread,
  lastBody,
  projectMeta,
  onOpen,
}: {
  thread: InboxThread;
  /** What Save as note starts from on an open thread; a closed one starts from its resolution */
  lastBody: string;
  projectMeta: ReadonlyMap<string, ProjectMeta>;
  onOpen: (id: string) => void;
}) {
  const [panel, setPanel] = useState<Panel>(null);
  const open = !isInboxClosed(thread.status);
  const toggle = (p: Panel) => setPanel(panel === p ? null : p);
  const close = () => setPanel(null);
  return (
    <div className="flex flex-col gap-1.5 border-t border-border p-2">
      <div className="flex gap-1">
        {open && (
          <FilterChip
            active={panel === "forward"}
            className={CHIP}
            onClick={() => toggle("forward")}
          >
            Forward
          </FilterChip>
        )}
        <FilterChip active={panel === "note"} className={CHIP} onClick={() => toggle("note")}>
          Save as note
        </FilterChip>
        {open && (
          <FilterChip active={panel === "issue"} className={CHIP} onClick={() => toggle("issue")}>
            Send as issue
          </FilterChip>
        )}
      </div>
      {panel === "forward" && <Forward thread={thread} projectMeta={projectMeta} onOpen={onOpen} />}
      {panel === "note" && <SaveAsNote thread={thread} lastBody={lastBody} onDone={close} />}
      {panel === "issue" && <SendAsIssue thread={thread} onDone={close} />}
    </div>
  );
}
