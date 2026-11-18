import type { InboxThread } from "@exegol/shared";
import { PICKER_CLASS, PICKER_LABEL_CLASS } from "../../agents/SpawnOptions";
import { SessionSelect } from "../SessionSelect";
import { useThreadAct } from "./InboxMoreActions";

const LABEL = {
  text: "Assigned to",
  title:
    "Only this session counts the thread as its own at its start. The project's other sessions can still read it",
  className: PICKER_LABEL_CLASS,
};

/** The one session of its project a thread is for: its other sessions do not count it as theirs */
export function InboxForSession({ thread, projectId }: { thread: InboxThread; projectId: string }) {
  const { busy, act } = useThreadAct(thread.id);
  return (
    <SessionSelect
      projectId={projectId}
      value={thread.toSession}
      onChange={(session) => void act("inbox.setSession", { session })}
      disabled={busy}
      className={PICKER_CLASS}
      label={LABEL}
    />
  );
}
