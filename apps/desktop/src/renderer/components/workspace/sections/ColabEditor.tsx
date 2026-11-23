import { COLAB_NAME_MAX, COLAB_PURPOSE_MAX, type Colab } from "@exegol/shared";
import { Button } from "@exegol/ui";
import { useState } from "react";
import { useAct } from "../../../hooks/use-act";
import { INPUT_CLASS, LABEL_CLASS } from "../../agents/SpawnOptions";
import { ConfirmDialog } from "../../common/ConfirmDialog";
import { ColabRoom } from "./ColabRoom";

/** Create a colab (colab null) or edit one: name, purpose, members. Only a person does this */
export function ColabEditor({
  colab,
  firstMember = null,
  onSaved,
  onDeleted,
}: {
  colab: Colab | null;
  /** A new colab starts with this project as a member (asked from its Inbox) */
  firstMember?: { id: string; name: string | undefined } | null;
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
    const created = await act<{ id: string }>("colabs.create", {
      name,
      purpose,
      firstMember: firstMember?.id,
    });
    if (created) onSaved(created.value.id);
  };

  return (
    <div className="flex flex-col gap-3 p-3 text-xs">
      <h3 className="text-sm font-semibold text-text-primary">
        {colab ? colab.name : "New colab"}
      </h3>
      {!colab && (
        <p className="leading-relaxed text-text-muted">
          Name it and say what it is for, then add the projects that work together
          {firstMember?.name ? `. ${firstMember.name} joins as its first member.` : "."}
        </p>
      )}
      <label className="flex flex-col gap-1">
        <span className={LABEL_CLASS}>Name</span>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={COLAB_NAME_MAX}
          placeholder="Landings"
          className={INPUT_CLASS}
        />
      </label>
      <label className="flex flex-col gap-1">
        <span className={LABEL_CLASS}>Purpose, read by agents</span>
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
        <label className="flex items-start gap-2">
          <input
            type="checkbox"
            checked={colab.notify}
            disabled={busy}
            onChange={(e) =>
              void act("colabs.setNotify", { id: colab.id, notify: e.target.checked })
            }
            className="mt-0.5 h-3.5 w-3.5 accent-accent"
          />
          <span className="leading-relaxed text-text-secondary">
            Tell sessions when a thread has news
            <span className="block text-text-muted">
              The session a thread is for, else the project's main one, gets one line while it rests
              at its prompt and you have not written to it for 10 minutes. Off, sessions find out
              when one starts or when you send them the thread.
            </span>
          </span>
        </label>
      )}

      {colab && <ColabRoom colab={colab} />}

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
