import type { PlanUsage, PlanWindow } from "@exegol/shared";

export interface TrayAgentRow {
  id: string;
  alias: string | null;
  cli_type: string;
  task_description: string | null;
  status: string;
  /** Seconds */
  started_at: number | null;
  /** Milliseconds */
  status_changed_at: number | null;
  project_id: string;
  project_name: string;
}

export type TrayAgentState = "needs-you" | "working" | "starting" | "idle";

export interface TrayAgent {
  id: string;
  label: string;
  state: TrayAgentState;
  detail: string;
}

export interface TrayProject {
  name: string;
  agents: TrayAgent[];
  hidden: TrayAgent[];
}

const STATE_TEXT: Record<TrayAgentState, string> = {
  "needs-you": "Needs you",
  working: "Working",
  starting: "Starting",
  idle: "Idle",
};
const STATE_RANK: Record<TrayAgentState, number> = {
  "needs-you": 0,
  working: 1,
  starting: 2,
  idle: 3,
};
export const TRAY_AGENTS_PER_PROJECT = 6;

/** "<1m", "12m", "3h 5m", "2d 4h" */
export function compactDuration(ms: number): string {
  const mins = Math.floor(ms / 60_000);
  if (mins < 1) return "<1m";
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return mins % 60 ? `${hours}h ${mins % 60}m` : `${hours}h`;
  return hours % 24 ? `${Math.floor(hours / 24)}d ${hours % 24}h` : `${Math.floor(hours / 24)}d`;
}

function stateOf(row: TrayAgentRow, awaiting: boolean): TrayAgentState {
  if (awaiting) return "needs-you";
  if (row.status === "running") return "working";
  if (row.status === "spawning") return "starting";
  return "idle";
}

/** "argo · Claude Code"; a named task replaces the CLI name ("rhea · iteris-landing") */
export function trayAgentLabel(row: TrayAgentRow, cliName: string): string {
  const task = row.task_description?.trim();
  const what = task && task !== cliName ? task.slice(0, 40) : cliName;
  return row.alias ? `${row.alias} · ${what}` : what;
}

/** Projects with someone needing you first, then working ones, then by name; agents the same way */
export function buildTrayProjects(
  rows: TrayAgentRow[],
  cliName: (cliType: string) => string,
  awaiting: (agentId: string) => boolean,
  now: number,
): TrayProject[] {
  const byProject = new Map<string, { name: string; agents: (TrayAgent & { at: number })[] }>();
  for (const row of rows) {
    const state = stateOf(row, awaiting(row.id));
    const since = row.status_changed_at ? compactDuration(now - row.status_changed_at) : null;
    const up = row.started_at ? compactDuration(now - row.started_at * 1000) : null;
    const detail = [since ? `${STATE_TEXT[state]} ${since}` : STATE_TEXT[state], up && `up ${up}`]
      .filter(Boolean)
      .join(" · ");
    const group = byProject.get(row.project_id) ?? { name: row.project_name, agents: [] };
    group.agents.push({
      id: row.id,
      label: trayAgentLabel(row, cliName(row.cli_type)),
      state,
      detail,
      at: row.status_changed_at ?? 0,
    });
    byProject.set(row.project_id, group);
  }
  const rank = (a: { state: TrayAgentState }) => STATE_RANK[a.state];
  return [...byProject.values()]
    .map((g) => {
      const sorted = g.agents
        .sort((a, b) => rank(a) - rank(b) || b.at - a.at)
        .map(({ at: _at, ...a }) => a);
      return {
        top: Math.min(...sorted.map(rank)),
        name: g.name,
        agents: sorted.slice(0, TRAY_AGENTS_PER_PROJECT),
        hidden: sorted.slice(TRAY_AGENTS_PER_PROJECT),
      };
    })
    .sort((a, b) => a.top - b.top || a.name.localeCompare(b.name))
    .map(({ top: _top, ...p }) => p);
}

/** "10 agents: 3 working, 1 needs you" */
export function traySummary(projects: TrayProject[]): string {
  const all = projects.flatMap((p) => [...p.agents, ...p.hidden]);
  const count = (s: TrayAgentState) => all.filter((a) => a.state === s).length;
  const parts = [
    count("needs-you") &&
      `${count("needs-you")} ${count("needs-you") === 1 ? "needs" : "need"} you`,
    count("working") && `${count("working")} working`,
    count("idle") && `${count("idle")} idle`,
  ].filter(Boolean);
  const head = `${all.length} agent${all.length === 1 ? "" : "s"}`;
  return parts.length ? `${head}: ${parts.join(", ")}` : head;
}

/** Changes when what the menu shows (besides the times) changes */
export function traySignature(projects: TrayProject[]): string {
  return projects
    .map(
      (p) => `${p.name}:${[...p.agents, ...p.hidden].map((a) => `${a.id}=${a.state}`).join(",")}`,
    )
    .join("|");
}

/** Agents in one state across projects, labelled "Project · alias · task" */
export function trayAgentsIn(projects: TrayProject[], state: TrayAgentState): TrayAgent[] {
  return projects.flatMap((p) =>
    [...p.agents, ...p.hidden]
      .filter((a) => a.state === state)
      .map((a) => ({ ...a, label: `${p.name} · ${a.label}` })),
  );
}

function windowLine(name: string, label: string, w: PlanWindow, now: number): string {
  const reset =
    w.resetsAt && w.resetsAt > now ? ` · resets in ${compactDuration(w.resetsAt - now)}` : "";
  return `${name} ${label}: ${Math.round(w.usedPercent)}%${reset}`;
}

/** "Plan limits · Claude Code 3% / 31%" plus one line per window */
export function trayLimits(
  usage: PlanUsage[],
  cliName: (cliType: string) => string,
  now: number,
): { title: string; lines: string[] } | null {
  if (usage.length === 0) return null;
  const pct = (w: PlanWindow | null) => (w ? `${Math.round(w.usedPercent)}%` : "?");
  const heads = usage.map((u) => `${cliName(u.cliType)} ${pct(u.session)} / ${pct(u.weekly)}`);
  const lines = usage.flatMap((u) => {
    const name = cliName(u.cliType);
    const stale = u.stale ? [`${name}: last read ${compactDuration(now - u.fetchedAt)} ago`] : [];
    return [
      ...(u.session ? [windowLine(name, "5h", u.session, now)] : []),
      ...(u.weekly ? [windowLine(name, "week", u.weekly, now)] : []),
      ...stale,
    ];
  });
  return { title: `Plan limits · ${heads.join(" · ")}`, lines };
}
