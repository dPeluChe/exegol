import type { AgentStatus } from "@exegol/shared";
import { describe, expect, it, vi } from "vitest";

vi.mock("../../hooks/use-trpc", () => ({ useProject: vi.fn(), useProjects: vi.fn() }));
vi.mock("../../stores/agents", () => ({ jumpToAgent: vi.fn(), useAgentStore: vi.fn() }));
const { groupSendTargets } = await import("./use-terminal-panel-actions");

const agent = (
  id: string,
  projectId: string,
  extra: { cliType?: string; status?: AgentStatus; alias?: string | null } = {},
) => ({
  id,
  projectId,
  cliType: "claude-code",
  status: "running" as AgentStatus,
  alias: null,
  ...extra,
});

describe("groupSendTargets", () => {
  it("lists live agents only: not itself, not shells, not ended ones", () => {
    const groups = groupSendTargets(
      [
        agent("self", "p1"),
        agent("a", "p1", { alias: "lupus" }),
        agent("sh", "p1", { cliType: "shell" }),
        agent("done", "p1", { status: "completed" }),
        agent("w", "p1", { cliType: "opencode", status: "waiting_input" }),
      ],
      "self",
      new Map([["p1", "Exegol"]]),
      "p1",
    );
    expect(groups).toEqual([
      {
        projectId: "p1",
        projectName: "Exegol",
        targets: [
          { id: "a", name: "lupus", cliType: "claude-code", projectId: "p1" },
          { id: "w", name: "opencode", cliType: "opencode", projectId: "p1" },
        ],
      },
    ]);
  });

  it("puts this project first, then the others by name", () => {
    const groups = groupSendTargets(
      [agent("z", "pz"), agent("a", "pa"), agent("c", "pc")],
      "self",
      new Map([
        ["pz", "Zeta"],
        ["pa", "Alpha"],
        ["pc", "Current"],
      ]),
      "pc",
    );
    expect(groups.map((g) => g.projectName)).toEqual(["Current", "Alpha", "Zeta"]);
  });
});
