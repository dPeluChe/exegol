import { describe, expect, it } from "vitest";
import {
  buildTrayProjects,
  compactDuration,
  TRAY_AGENTS_PER_PROJECT,
  type TrayAgentRow,
  trayAgentsIn,
  trayLimits,
  traySummary,
} from "./tray-menu";

const NOW = 1_800_000_000_000;
const MIN = 60_000;

function row(over: Partial<TrayAgentRow>): TrayAgentRow {
  return {
    id: "a",
    alias: "argo",
    cli_type: "claude-code",
    task_description: "Claude Code",
    status: "waiting_input",
    started_at: (NOW - 120 * MIN) / 1000,
    status_changed_at: NOW - 5 * MIN,
    project_id: "p1",
    project_name: "Exegol",
    ...over,
  };
}

const build = (rows: TrayAgentRow[], awaiting: string[] = []) =>
  buildTrayProjects(
    rows,
    () => "Claude Code",
    (id) => awaiting.includes(id),
    NOW,
  );

describe("compactDuration", () => {
  it("formats minutes, hours and days", () => {
    expect(compactDuration(30_000)).toBe("<1m");
    expect(compactDuration(12 * MIN)).toBe("12m");
    expect(compactDuration(185 * MIN)).toBe("3h 5m");
    expect(compactDuration(120 * MIN)).toBe("2h");
    expect(compactDuration(52 * 60 * MIN)).toBe("2d 4h");
  });
});

describe("buildTrayProjects", () => {
  it("labels by alias and task, with state and age", () => {
    const [p] = build([row({}), row({ id: "b", alias: "rhea", task_description: "landing" })]);
    expect(p?.agents.map((a) => a.label).sort()).toEqual(["argo · Claude Code", "rhea · landing"]);
    expect(p?.agents[0]?.detail).toBe("Idle 5m · up 2h");
  });

  it("puts the project needing you first, then working, then by name", () => {
    const projects = build(
      [
        row({ id: "a", project_id: "p1", project_name: "Alpha" }),
        row({ id: "b", project_id: "p2", project_name: "Beta", status: "running" }),
        row({ id: "c", project_id: "p3", project_name: "Gamma" }),
      ],
      ["c"],
    );
    expect(projects.map((p) => p.name)).toEqual(["Gamma", "Beta", "Alpha"]);
    expect(projects[0]?.agents[0]?.state).toBe("needs-you");
  });

  it("keeps extra agents of a project in hidden", () => {
    const rows = Array.from({ length: TRAY_AGENTS_PER_PROJECT + 2 }, (_, i) =>
      row({ id: `a${i}` }),
    );
    const [p] = build(rows);
    expect(p?.agents).toHaveLength(TRAY_AGENTS_PER_PROJECT);
    expect(p?.hidden).toHaveLength(2);
    expect(traySummary(build(rows))).toBe(`${TRAY_AGENTS_PER_PROJECT + 2} agents: 8 idle`);
  });

  it("summarizes states", () => {
    const projects = build([row({ id: "a", status: "running" }), row({ id: "b" })], ["b"]);
    expect(traySummary(projects)).toBe("2 agents: 1 needs you, 1 working");
  });
});

describe("trayAgentsIn", () => {
  it("lists one state across projects with the project name", () => {
    const projects = build([
      row({ id: "a", status: "running" }),
      row({
        id: "b",
        project_id: "p2",
        project_name: "Orbital",
        alias: "sirius",
        status: "running",
      }),
      row({ id: "c" }),
    ]);
    expect(trayAgentsIn(projects, "working").map((a) => a.label)).toEqual([
      "Exegol · argo · Claude Code",
      "Orbital · sirius · Claude Code",
    ]);
  });
});

describe("trayLimits", () => {
  it("is null with no reading", () => {
    expect(trayLimits([], () => "Claude Code", NOW)).toBeNull();
  });

  it("titles both windows and lists their resets", () => {
    const limits = trayLimits(
      [
        {
          cliType: "claude-code",
          session: { usedPercent: 3.4, resetsAt: NOW + 158 * MIN, windowMins: 300 },
          weekly: { usedPercent: 31, resetsAt: null, windowMins: 10_080 },
          fetchedAt: NOW - 10 * MIN,
          stale: true,
        },
      ],
      () => "Claude Code",
      NOW,
    );
    expect(limits?.title).toBe("Plan limits · Claude Code 3% / 31%");
    expect(limits?.lines).toEqual([
      "Claude Code 5h: 3% · resets in 2h 38m",
      "Claude Code week: 31%",
      "Claude Code: last read 10m ago",
    ]);
  });
});
