import { type InboxThread, sameName } from "@exegol/shared";
import { useSessionTargets } from "../../../hooks/use-session-targets";
import { AgentIcon } from "../../common/AgentIcon";
import { FilterChip } from "../../common/FilterChip";
import { sendLabel } from "../../terminal/send-targets";
import { SESSION_CHIP, useThreadAct } from "./InboxMoreActions";

/** The one session of its project a thread is for: its other sessions do not count it as theirs */
export function InboxForSession({ thread, projectId }: { thread: InboxThread; projectId: string }) {
  const { targets, cliNames } = useSessionTargets(projectId);
  const forName = thread.toSession;
  const { busy, act } = useThreadAct(thread.id);
  const set = (session: string | null) => void act("inbox.setSession", { session });
  if (targets.length === 0 && !forName) return null;
  const gone = !!forName && !targets.some((t) => sameName(t.name, forName));

  return (
    <div className="flex flex-wrap items-center gap-1">
      <span className="text-[10px] text-text-muted">For</span>
      <FilterChip
        active={!forName}
        className={SESSION_CHIP}
        disabled={busy}
        onClick={() => set(null)}
      >
        Any session
      </FilterChip>
      {targets.map((target) => (
        <FilterChip
          key={target.id}
          active={!!forName && sameName(target.name, forName)}
          className={SESSION_CHIP}
          disabled={busy}
          onClick={() => set(target.name)}
        >
          <AgentIcon provider={target.cliType} size={12} />
          <span className="truncate">{sendLabel(target, cliNames[target.id])}</span>
        </FilterChip>
      ))}
      {gone && (
        <span
          className="text-[10px] text-text-muted"
          title="No open session has this name, so the whole project counts the thread"
        >
          {forName} (not open)
        </span>
      )}
    </div>
  );
}
