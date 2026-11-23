import { type CliUpdateStatus, cliRestartNeeded, LIVE_STATUSES } from "@exegol/shared";
import { ArrowUpCircle, RefreshCw } from "lucide-react";
import { useState } from "react";
import { updateAndRestart, useCliUpdates } from "../../hooks/use-cli-updates";
import { useProjects } from "../../hooks/use-trpc";
import { sessionWhere } from "../../lib/agent-label";
import { type AgentState, useAgentStore } from "../../stores/agents";
import { useCliRestartStore } from "../../stores/cli-restarts";
import { ChoiceDialog } from "../common/ChoiceDialog";
import { SessionChips } from "../common/SessionChips";
import { RestartPendingDialog } from "./RestartPendingDialog";

const chip = "flex shrink-0 items-center gap-1 text-[9px]";

/** Live sessions of one CLI: an update restarts them all */
export function liveSessionsOf(cliType: string): string[] {
  return Object.values(useAgentStore.getState().agents)
    .filter((a) => a.cliType === cliType && LIVE_STATUSES.has(a.status))
    .map((a) => a.id);
}

/** Its other live sessions an update concerns: behind the installed version, or all of them
 *  when a newer release is to be installed */
function otherSessions(agent: AgentState, status: CliUpdateStatus, update: boolean): AgentState[] {
  return Object.values(useAgentStore.getState().agents).filter(
    (a) =>
      a.id !== agent.id &&
      a.cliType === agent.cliType &&
      !a.launchedInShell &&
      LIVE_STATUSES.has(a.status) &&
      (update || cliRestartNeeded(a, status)),
  );
}

/** "name · project" for a session, so the list says where each one is */
function useSessionWhere(): (a: AgentState) => string {
  const { data: projects = [] } = useProjects();
  return (a) => sessionWhere(a, projects);
}

interface ScopeChoice {
  title: string;
  others: AgentState[];
  /** Only this session, or this one and the others */
  run: (all: boolean) => void;
}

/** Restart onto a CLI version installed since the session started (after this turn if it is
 *  working), or Update when a newer release is out: the command runs in a terminal beside it.
 *  With other sessions of the same CLI concerned, it asks: only this one, or all (listed) */
export function CliUpdateControl({ agentId }: { agentId: string }) {
  const agent = useAgentStore((s) => s.agents[agentId]);
  const pending = useCliRestartStore((s) => s.pending[agentId]);
  const status = useCliUpdates().get(agent?.cliType ?? "");
  const [choice, setChoice] = useState<ScopeChoice | null>(null);
  const [askedAt, setAskedAt] = useState<number | null>(null);
  // The restart ran or was cancelled: the next one starts with no dialog open
  if (!pending && askedAt !== null) setAskedAt(null);
  if (!agent) return null;

  /** Ask first when other sessions are concerned; else run for this one */
  const withScope = (title: string, update: boolean, run: (all: boolean) => void) => {
    const others = status ? otherSessions(agent, status, update) : [];
    if (others.length === 0) run(false);
    else setChoice({ title, others, run });
  };

  const dialog = choice && (
    <RestartScopeDialog choice={choice} agent={agent} onClose={() => setChoice(null)} />
  );

  if (pending) {
    return (
      <>
        <button
          type="button"
          onClick={() => setAskedAt(Date.now())}
          className={`${chip} text-accent hover:text-text-primary`}
          title={
            pending === "update"
              ? "Restarts once the update is installed and this turn ends. Click to restart now or cancel"
              : "Restarts on the new version when this turn ends. Click to restart now or cancel"
          }
        >
          <RefreshCw className="h-2.5 w-2.5 animate-spin" />
          {pending === "update" ? "Restarts after the update" : "Restarts after this turn"}
        </button>
        {askedAt !== null && (
          <RestartPendingDialog
            agent={agent}
            update={pending === "update"}
            askedAt={askedAt}
            onClose={() => setAskedAt(null)}
          />
        )}
      </>
    );
  }

  // A CLI typed in a shell restarts by Continue there: Suspend + Resume would replace the shell
  const restartable = !agent.launchedInShell;
  if (status && restartable && cliRestartNeeded(agent, status)) {
    return (
      <>
        <button
          type="button"
          onClick={() =>
            withScope(`Restart on ${status.installed}?`, false, (all) => {
              const restarts = useCliRestartStore.getState();
              restarts.request(agentId);
              if (all) for (const a of otherSessions(agent, status, false)) restarts.request(a.id);
            })
          }
          className={`${chip} text-accent hover:text-text-primary`}
          title={`${status.installed} is installed; this session runs ${agent.cliVersion ?? "an older one"}. Restart it on the new version: the conversation resumes (after the current turn if it is working)`}
        >
          <RefreshCw className="h-2.5 w-2.5" />
          Restart to update
        </button>
        {dialog}
      </>
    );
  }

  const cmd = status?.updateCommand;
  if (status?.updateAvailable && cmd) {
    return (
      <>
        <button
          type="button"
          onClick={() =>
            withScope(`Update to ${status.latest}?`, true, (all) =>
              updateAndRestart(
                agent.projectId,
                [cmd],
                all ? liveSessionsOf(agent.cliType) : [agentId],
                agentId,
              ).catch((err) => console.error("[CliUpdate] Update failed to start:", err)),
            )
          }
          className={`${chip} text-text-muted hover:text-text-primary`}
          title={`${status.latest} is out (installed: ${status.installed}). Runs \`${cmd}\` ${restartable ? "in a terminal beside this session, then restarts the sessions you choose on it as each one is free (the conversation, model, YOLO and mode carry over)" : "in this terminal once its CLI is closed (else beside it); Continue then starts the new version"}${status.updateNote ? `. ${status.updateNote}` : ""}`}
        >
          <ArrowUpCircle className="h-2.5 w-2.5" />
          Update {status.latest}
        </button>
        {dialog}
      </>
    );
  }
  if (!restartable) return null;
  // Always there: restart by hand (a CLI that asks to be reopened, a stuck session)
  return (
    <button
      type="button"
      onClick={() => useCliRestartStore.getState().request(agentId)}
      className={`${chip} text-text-muted hover:text-text-primary`}
      title="Restart this session: the CLI starts again and resumes the conversation, with the same model, YOLO and mode (after its turn if it is working)"
    >
      <RefreshCw className="h-2.5 w-2.5" />
      Restart
    </button>
  );
}

function RestartScopeDialog({
  choice,
  agent,
  onClose,
}: {
  choice: ScopeChoice;
  agent: AgentState;
  onClose: () => void;
}) {
  const where = useSessionWhere();
  return (
    <ChoiceDialog
      title={choice.title}
      onClose={onClose}
      choices={[
        { label: "Cancel", kind: "muted" },
        { label: "Only this one", run: () => choice.run(false) },
        { label: `All ${choice.others.length + 1}`, kind: "primary", run: () => choice.run(true) },
      ]}
    >
      <p>
        This one: <span className="text-text-primary">{where(agent)}</span>
      </p>
      <div>
        <p className="text-text-muted">Other sessions of the same CLI:</p>
        <div className="mt-1">
          <SessionChips sessions={choice.others} />
        </div>
      </div>
      <p className="text-text-muted">
        Each restarts when its turn ends and resumes its conversation.
      </p>
    </ChoiceDialog>
  );
}
