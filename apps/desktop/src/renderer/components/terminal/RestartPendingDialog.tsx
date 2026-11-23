import { pendingRestartText } from "../../lib/restart-pending";
import type { AgentState } from "../../stores/agents";
import { useCliRestartStore } from "../../stores/cli-restarts";
import { ChoiceDialog } from "../common/ChoiceDialog";

/** A restart waits on a turn that may never end (a status that was read wrong): the person
 *  decides here, so a second click on the waiting chip no longer cancels it unseen */
export function RestartPendingDialog({
  agent,
  update,
  askedAt,
  onClose,
}: {
  agent: AgentState;
  update: boolean;
  askedAt: number;
  onClose: () => void;
}) {
  const text = pendingRestartText(agent, update, askedAt);
  const restarts = () => useCliRestartStore.getState();
  return (
    <ChoiceDialog
      title="Restart now?"
      onClose={onClose}
      choices={[
        { label: "Cancel the restart", kind: "muted", run: () => restarts().cancel(agent.id) },
        { label: "Keep waiting", focus: true },
        { label: text.nowLabel, kind: "primary", run: () => restarts().request(agent.id, "now") },
      ]}
    >
      <p>
        {text.waits}
        {text.working && ` ${text.working}`}
      </p>
      <p className="text-text-muted">{text.nowNote}</p>
    </ChoiceDialog>
  );
}
