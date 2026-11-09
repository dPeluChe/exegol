import type { Project } from "@exegol/shared";
import type { ActiveAgent } from "../db/queries/agents";

export interface SessionFacts {
  /** A permission prompt or a dialog on its screen: only the person answers it */
  needsUser: boolean;
  /** Milliseconds since its PTY last printed; null when never seen */
  quietMs: number | null;
  /** restart: a newer CLI is installed. release: one is out, not installed */
  cliUpdate?: "restart" | "release";
}

export type SessionState = "working" | "waits_on_person" | "at_prompt" | "starting";

export interface FleetSession {
  id: string;
  name: string | null;
  cli: string;
  state: SessionState;
  minutes_in_state: number | null;
  quiet_minutes: number | null;
  task: string;
  cli_update?: "restart" | "release";
}

export interface FleetProject {
  project: string;
  inbox_waiting: number;
  sessions: FleetSession[];
}

const minutes = (ms: number | null) => (ms == null ? null : Math.max(0, Math.round(ms / 60_000)));

export function sessionState(status: string, needsUser: boolean): SessionState {
  if (needsUser) return "waits_on_person";
  if (status === "running") return "working";
  if (status === "spawning") return "starting";
  return "at_prompt";
}

/** Every project, the Commander's own left out; sessions that need the person first */
export function fleetView(
  projects: Pick<Project, "id" | "name">[],
  agents: ActiveAgent[],
  facts: (agentId: string) => SessionFacts,
  inboxWaiting: (projectId: string) => number,
  now = Date.now(),
): FleetProject[] {
  const order: SessionState[] = ["waits_on_person", "at_prompt", "working", "starting"];
  return projects.map((p) => ({
    project: p.name,
    inbox_waiting: inboxWaiting(p.id),
    sessions: agents
      .filter((a) => a.projectId === p.id && a.cliType !== "shell")
      .map((a) => {
        const { needsUser, quietMs, cliUpdate } = facts(a.id);
        const since = a.statusChangedAt ? now - a.statusChangedAt * 1000 : null;
        return {
          id: a.id,
          name: a.alias ?? null,
          cli: a.cliType,
          state: sessionState(a.status, needsUser),
          minutes_in_state: minutes(since),
          quiet_minutes: minutes(quietMs),
          task: a.taskDescription.slice(0, 120),
          ...(cliUpdate ? { cli_update: cliUpdate } : {}),
        };
      })
      .sort((a, b) => order.indexOf(a.state) - order.indexOf(b.state)),
  }));
}
