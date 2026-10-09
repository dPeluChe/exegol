import { type CliUpdateStatus, LIVE_STATUSES } from "@exegol/shared";
import * as Dialog from "@radix-ui/react-dialog";
import { ArrowUpCircle, RefreshCw } from "lucide-react";
import { useState } from "react";
import { restartNeeded, updateAndRestart, useCliUpdates } from "../../hooks/use-cli-updates";
import { useProjects } from "../../hooks/use-trpc";
import { sessionName } from "../../lib/agent-label";
import { type AgentState, useAgentStore } from "../../stores/agents";
import { useCliRestartStore } from "../../stores/cli-restarts";
import { SessionChips } from "../common/SessionChips";

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
      LIVE_STATUSES.has(a.status) &&
      (update || restartNeeded(a, status)),
  );
}

/** "name · project" for a session, so the list says where each one is */
function useSessionWhere(): (a: AgentState) => string {
  const { data: projects = [] } = useProjects();
  const nameOf = new Map(projects.map((p) => [p.id, p.name]));
  return (a) => `${sessionName(a)} · ${nameOf.get(a.projectId) ?? "another project"}`;
}

interface ScopeChoice {
  title: string;
  others: AgentState[];
  /** Only this session, or this one and the others */
  run: (all: boolean) => void;
}

/** Restart onto a CLI version installed since the session started (after this turn if it is
 *  working), or Update when a newer release is out: the command runs in a new tab you can see.
 *  With other sessions of the same CLI concerned, it asks: only this one, or all (listed) */
export function CliUpdateControl({ agentId }: { agentId: string }) {
  const agent = useAgentStore((s) => s.agents[agentId]);
  const pending = useCliRestartStore((s) => s.pending[agentId]);
  const status = useCliUpdates().get(agent?.cliType ?? "");
  const [choice, setChoice] = useState<ScopeChoice | null>(null);
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
          onClick={() => useCliRestartStore.getState().cancel(agentId)}
          className={`${chip} text-accent hover:text-text-primary`}
          title={
            pending === "update"
              ? "Restarts once the update is installed and this turn ends. Click to cancel"
              : "Restarts on the new version when this turn ends. Click to cancel"
          }
        >
          <RefreshCw className="h-2.5 w-2.5 animate-spin" />
          {pending === "update" ? "Restarts after the update" : "Restarts after this turn"}
        </button>
        <button
          type="button"
          onClick={() => useCliRestartStore.getState().request(agentId, "now")}
          className={`${chip} text-text-muted hover:text-text-primary`}
          title="Restart now, cutting the current turn (the conversation still resumes)"
        >
          Now
        </button>
      </>
    );
  }

  if (status && restartNeeded(agent, status)) {
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
              ).catch((err) => console.error("[CliUpdate] Update failed to start:", err)),
            )
          }
          className={`${chip} text-text-muted hover:text-text-primary`}
          title={`${status.latest} is out (installed: ${status.installed}). Runs \`${cmd}\` in a new tab, then restarts the sessions you choose on it as each one is free (the conversation, model, YOLO and mode carry over)${status.updateNote ? `. ${status.updateNote}` : ""}`}
        >
          <ArrowUpCircle className="h-2.5 w-2.5" />
          Update {status.latest}
        </button>
        {dialog}
      </>
    );
  }
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
  const pick = (all: boolean) => {
    choice.run(all);
    onClose();
  };
  const button = "rounded-lg px-3 py-1.5 text-[11px] font-medium";
  return (
    <Dialog.Root open onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/60" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 flex w-full max-w-sm -translate-x-1/2 -translate-y-1/2 flex-col gap-3 rounded-lg border border-border bg-bg-secondary p-5 shadow-2xl">
          <Dialog.Title className="text-sm font-semibold text-text-primary">
            {choice.title}
          </Dialog.Title>
          <Dialog.Description asChild>
            <div className="space-y-2 text-[11px] text-text-secondary">
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
            </div>
          </Dialog.Description>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className={`${button} text-text-muted hover:bg-white/5`}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => pick(false)}
              className={`${button} text-text-secondary hover:bg-white/5`}
            >
              Only this one
            </button>
            <button
              type="button"
              onClick={() => pick(true)}
              className={`${button} bg-accent font-semibold text-white hover:bg-accent/90`}
            >
              All {choice.others.length + 1}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
