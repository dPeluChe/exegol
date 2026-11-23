import { turnTime } from "./busy-time";
import { formatDuration } from "./format";

type Timed = Parameters<typeof turnTime>[0];

/** What the dialog of a waiting restart says: how long the turn it waits on has run (only while
 *  the session shows as working), and what Restart now means when an update is on its way */
export function pendingRestartText(
  agent: Timed,
  update: boolean,
  now: number,
): { waits: string; working: string | null; nowLabel: string; nowNote: string } {
  const turn = turnTime(agent, now);
  const working = turn?.state === "working" ? formatDuration(1, turn.seconds + 1) : null;
  return {
    waits: update
      ? "This session restarts once the update is installed and its turn ends."
      : "This session restarts when its turn ends.",
    working: working && `It has shown as working for ${working}.`,
    nowLabel: update ? "Restart now, without the update" : "Restart now",
    nowNote: update
      ? "Restart now cuts the turn and starts the version installed today: it will ask to restart again once the update is in. The conversation resumes either way."
      : "Restart now cuts the turn if one is running. The conversation resumes either way.",
  };
}
