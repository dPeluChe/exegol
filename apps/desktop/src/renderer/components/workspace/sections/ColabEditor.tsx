import {
  COLAB_NAME_MAX,
  COLAB_PURPOSE_MAX,
  COLAB_ROLE_MAX,
  type Colab,
  type ColabMember,
} from "@exegol/shared";
import { Button, cn } from "@exegol/ui";
import { X } from "lucide-react";
import { useState } from "react";
import { useAct } from "../../../hooks/use-act";
import { useProjectShapes } from "../../../hooks/use-project-shapes";
import { INPUT_CLASS } from "../../agents/SpawnOptions";
import { ConfirmDialog } from "../../common/ConfirmDialog";
import type { ProjectMeta } from "../../common/ProjectChip";

const LABEL = "text-[10px] uppercase tracking-wide text-text-muted";

const memberLabel = (m: ColabMember) => (m.repo ? `${m.projectName} / ${m.repo}` : m.projectName);

function AddMember({
  colabId,
  projectMeta,
}: {
  colabId: string;
  projectMeta: ReadonlyMap<string, ProjectMeta>;
}) {
  const shapes = useProjectShapes();
  const { busy, act } = useAct("Not added");
  const [projectId, setProjectId] = useState("");
  const [repo, setRepo] = useState("");
  const [role, setRole] = useState("");
  const repos = projectId ? (shapes?.[projectId]?.repos ?? []) : [];

  const add = async () => {
    if (!(await act("colabs.addMember", { colabId, projectId, repo, role }))) return;
    setProjectId("");
    setRepo("");
    setRole("");
  };

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <select
        value={projectId}
        onChange={(e) => {
          setProjectId(e.target.value);
          setRepo("");
        }}
        className={cn(INPUT_CLASS, "w-44")}
      >
        <option value="">Project</option>
        {[...projectMeta].map(([id, meta]) => (
          <option key={id} value={id}>
            {meta.name}
          </option>
        ))}
      </select>
      {repos.length > 0 && (
        <select
          value={repo}
          onChange={(e) => setRepo(e.target.value)}
          className={cn(INPUT_CLASS, "w-44")}
          title="A workspace: pick the repo inside it that takes part"
        >
          <option value="">Whole project</option>
          {repos.map((folder) => (
            <option key={folder} value={folder}>
              {folder}
            </option>
          ))}
        </select>
      )}
      <input
        value={role}
        onChange={(e) => setRole(e.target.value)}
        maxLength={COLAB_ROLE_MAX}
        placeholder="Role: blueprint, clone of it"
        className={cn(INPUT_CLASS, "w-48")}
      />
      <Button size="sm" disabled={busy || !projectId} onClick={() => void add()}>
        Add member
      </Button>
    </div>
  );
}

/** Create a colab (colab null) or edit one: name, purpose, members. Only a person does this */
export function ColabEditor({
  colab,
  projectMeta,
  onSaved,
  onDeleted,
}: {
  colab: Colab | null;
  projectMeta: ReadonlyMap<string, ProjectMeta>;
  onSaved: (id: string) => void;
  onDeleted: () => void;
}) {
  const [name, setName] = useState(colab?.name ?? "");
  const [purpose, setPurpose] = useState(colab?.purpose ?? "");
  const [confirming, setConfirming] = useState(false);
  const { busy, act } = useAct(colab ? `${colab.name}: not done` : "Colab not created");
  const changed = name !== (colab?.name ?? "") || purpose !== (colab?.purpose ?? "");

  const save = async () => {
    if (colab) {
      if (await act("colabs.update", { id: colab.id, name, purpose })) {
        onSaved(colab.id);
      }
      return;
    }
    const created = await act<{ id: string }>("colabs.create", { name, purpose });
    if (created) onSaved(created.value.id);
  };

  const remove = async (m: ColabMember) => {
    if (!colab) return;
    await act("colabs.removeMember", { colabId: colab.id, ...m });
  };

  return (
    <div className="flex flex-col gap-3 p-3 text-xs">
      <h3 className="text-sm font-semibold text-text-primary">
        {colab ? colab.name : "New colab"}
      </h3>
      <label className="flex flex-col gap-1">
        <span className={LABEL}>Name</span>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={COLAB_NAME_MAX}
          placeholder="Landings"
          className={INPUT_CLASS}
        />
      </label>
      <label className="flex flex-col gap-1">
        <span className={LABEL}>Purpose, read by agents</span>
        <textarea
          value={purpose}
          onChange={(e) => setPurpose(e.target.value)}
          rows={3}
          maxLength={COLAB_PURPOSE_MAX}
          placeholder="What belongs here: fixes to the blueprint found in its clones"
          className={INPUT_CLASS}
        />
      </label>
      <div className="flex items-center gap-2">
        <Button size="sm" disabled={busy || !name.trim() || !changed} onClick={() => void save()}>
          {colab ? "Save" : "Create colab"}
        </Button>
        {colab && (
          <Button size="sm" variant="ghost" className="ml-auto" onClick={() => setConfirming(true)}>
            Delete colab
          </Button>
        )}
      </div>

      {colab && (
        <div className="flex flex-col gap-1.5 border-t border-border pt-3">
          <span className={LABEL}>Members</span>
          {colab.members.length === 0 && (
            <p className="text-text-muted">No members yet: add the projects that work together.</p>
          )}
          {colab.members.map((m) => (
            <div key={`${m.projectId}/${m.repo}`} className="flex items-center gap-2">
              <span className="truncate text-text-primary">{memberLabel(m)}</span>
              {m.role && <span className="truncate text-text-muted">{m.role}</span>}
              <button
                type="button"
                aria-label="Remove member"
                disabled={busy}
                onClick={() => void remove(m)}
                className="ml-auto rounded p-0.5 text-text-muted hover:bg-white/5 hover:text-text-primary"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          ))}
          <AddMember colabId={colab.id} projectMeta={projectMeta} />
        </div>
      )}

      {colab && (
        <ConfirmDialog
          open={confirming}
          onOpenChange={setConfirming}
          title={`Delete ${colab.name}?`}
          description="Its members stay as they are. Its threads arrive with the colab inbox."
          confirmLabel="Delete"
          variant="destructive"
          autoFocusCancel
          onConfirm={() => {
            void act("colabs.delete", { id: colab.id }).then((done) => {
              if (done) onDeleted();
            });
          }}
        />
      )}
    </div>
  );
}
