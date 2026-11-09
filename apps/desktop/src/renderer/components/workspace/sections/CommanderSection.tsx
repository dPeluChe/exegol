import type { Agent } from "@exegol/shared";
import { Button } from "@exegol/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useAct } from "../../../hooks/use-act";
import { useLaunchableProviders } from "../../../hooks/use-providers";
import { useResumeAgent } from "../../../hooks/use-resume-agent";
import { takesPrompt } from "../../../lib/github-handoff";
import { isOpenSession } from "../../../lib/sidebar-views";
import { openInNewTab } from "../../../lib/spawn-shell";
import { trpcInvoke, trpcMutate } from "../../../lib/trpc-client";
import { type AgentState, showProject, useAgentStore } from "../../../stores/agents";
import { type CompanyView, useAppStore } from "../../../stores/app";
import { toastError } from "../../../stores/toasts";
import { ModelSelect } from "../../agents/ModelSelect";
import { AgentIcon } from "../../common/AgentIcon";
import { FilterChip } from "../../common/FilterChip";
import { SegmentedTabs } from "../../common/SegmentedTabs";
import { CompanySession } from "./CompanySession";

type Autonomy = "answer" | "ask";

interface CommanderState {
  projectId: string | null;
  last: Agent | null;
  autonomy: Autonomy;
  feed: boolean;
}

const KEY = ["commander"];
const NAME = "Commander";
const OPENING =
  "Read your notes, then fleet_status. Tell me in a few lines what needs me, what finished and what is stuck.";

const AUTONOMY: { id: Autonomy; label: string }[] = [
  { id: "answer", label: "Answers when sure" },
  { id: "ask", label: "Asks me first" },
];

/** `sessionId` is in the key: a session that starts or ends reads `last` again */
function useCommander(sessionId: string | null) {
  return useQuery({
    queryKey: [...KEY, sessionId],
    queryFn: () => trpcInvoke<CommanderState>("commander.state"),
    placeholderData: (previous) => previous,
  });
}

function Options({ state }: { state: CommanderState }) {
  const queryClient = useQueryClient();
  const { act } = useAct("Not changed");
  const set = async (procedure: string, input: Record<string, unknown>) => {
    if (await act(procedure, input)) void queryClient.invalidateQueries({ queryKey: KEY });
  };
  return (
    <div className="flex flex-wrap items-center gap-2">
      <SegmentedTabs
        tabs={AUTONOMY}
        active={state.autonomy}
        onChange={(autonomy) => void set("commander.setAutonomy", { autonomy })}
        compact
        label="How the Commander answers sessions"
      />
      <FilterChip
        active={state.feed}
        onClick={() => void set("commander.setFeed", { on: !state.feed })}
      >
        <span title="Exegol tells it when a session ends a turn, waits on you or closes, a few times an hour at most. Each one is a turn of its model.">
          {state.feed ? "Feed on" : "Feed off"}
        </span>
      </FilterChip>
    </div>
  );
}

/** A tab in the Commander's own project; the Dashboard stays in front */
function openBehindDashboard(agent: Agent) {
  showProject(agent.projectId);
  openInNewTab(agent, NAME);
  const app = useAppStore.getState();
  app.openDashboard();
  app.setDashboardMode("commander");
}

function StartCard({ state }: { state: CommanderState }) {
  const queryClient = useQueryClient();
  const clis = useLaunchableProviders().filter(takesPrompt);
  const [picked, setPicked] = useState<string | null>(null);
  const cli = picked ?? clis.find((c) => c.id === "claude-code")?.id ?? clis[0]?.id ?? null;
  const [model, setModel] = useState("");
  const [busy, setBusy] = useState(false);
  const { resume, pending } = useResumeAgent();

  const done = () => void queryClient.invalidateQueries({ queryKey: KEY });
  const start = async () => {
    if (!cli) return;
    setBusy(true);
    try {
      const { projectId } = await trpcMutate<{ projectId: string }>("commander.prepare");
      const agent = await trpcMutate<Agent>("agents.spawn", {
        projectId,
        cliType: cli,
        name: NAME,
        taskDescription: OPENING,
        model: model.trim() || undefined,
      });
      openBehindDashboard(agent);
      done();
    } catch (err) {
      toastError("Commander not started")(err);
    } finally {
      setBusy(false);
    }
  };
  const last = state.last;

  return (
    <div className="mx-auto mt-10 flex w-full max-w-md flex-col gap-3 rounded-lg border border-border bg-bg-secondary p-4">
      <div>
        <h2 className="text-sm font-semibold text-text-primary">Commander</h2>
        <p className="mt-1 text-[11px] text-text-muted">
          One conversation about every other session: what needs you, what finished, what is stuck.
          It hands your requests to the right session, answers a session only as you allow below,
          and never a tool permission.
        </p>
      </div>
      {last && (
        <Button
          size="sm"
          disabled={pending || busy}
          onClick={() => void resume(last).then(done).catch(toastError("Commander not resumed"))}
        >
          Resume the last conversation
        </Button>
      )}
      <div className="flex flex-wrap gap-1">
        {clis.map((c) => (
          <FilterChip key={c.id} active={c.id === cli} onClick={() => setPicked(c.id)}>
            <AgentIcon provider={c.id} size={12} />
            {c.name}
          </FilterChip>
        ))}
        {clis.length === 0 && (
          <span className="text-[11px] text-text-muted">No agent CLI is installed.</span>
        )}
      </div>
      {cli && (
        <ModelSelect
          key={cli}
          id="commander-model"
          providerId={cli}
          label="Model"
          value={model}
          onChange={setModel}
        />
      )}
      <Options state={state} />
      <Button
        size="sm"
        variant={last ? "outline" : "default"}
        disabled={!cli || busy || pending}
        onClick={() => void start()}
      >
        {last ? "Start a new conversation" : "Start the Commander"}
      </Button>
    </div>
  );
}

/** The Commander's session as a chat, or the card that starts it */
export function CommanderSection() {
  // Its project never changes once made; `last` does, so that read follows the session
  const projectId = useCommander(null).data?.projectId ?? null;
  // An id, not the object: the store changes on every activity tick
  const sessionId = useAgentStore((s) => {
    if (!projectId) return null;
    let newest: AgentState | null = null;
    for (const a of Object.values(s.agents)) {
      if (a.projectId !== projectId || !isOpenSession(a)) continue;
      if (!newest || (a.startedAt ?? 0) > (newest.startedAt ?? 0)) newest = a;
    }
    return newest?.id ?? null;
  });
  const session = useAgentStore((s) => (sessionId ? s.agents[sessionId] : undefined));
  const { data: state } = useCommander(sessionId);
  const [view, setView] = useState<CompanyView>("chat");
  if (!state) return null;
  if (!session) return <StartCard state={state} />;
  return (
    <div className="mx-auto flex min-h-0 w-full max-w-3xl flex-1 flex-col gap-2 px-4 pb-4">
      <div className="flex items-center justify-end">
        <Options state={state} />
      </div>
      <div className="min-h-0 flex-1">
        <CompanySession agent={session} where="Every project" picked={view} onPick={setView} />
      </div>
    </div>
  );
}
