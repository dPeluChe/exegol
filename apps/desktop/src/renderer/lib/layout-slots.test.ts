import { describe, expect, it, vi } from "vitest";

vi.mock("../stores/agents", () => ({ showProject: vi.fn(), useAgentStore: { getState: vi.fn() } }));
const { computeCustomPresetTransformation, templateFromLayout } = await import("./layout-presets");
const { describeLayout } = await import("./project-layouts");

const split = (...ids: string[]) =>
  ({
    type: "split",
    direction: "horizontal",
    sizes: [60, 25, 15],
    children: ids.map((paneId) => ({ type: "pane", paneId })),
  }) as never;

describe("saved layout slots", () => {
  const panes = {
    b: { id: "b", type: "browser", url: "http://localhost:3000/courts" },
    t: { id: "t", type: "terminal", agentId: "sh1" },
    a: { id: "a", type: "terminal", agentId: "cl1" },
  } as never;
  const agents: Record<string, object> = {
    sh1: { cliType: "shell" },
    cl1: { cliType: "claude-code", model: "opus", yolo: true, accessMode: "write" },
  };
  const saved = templateFromLayout(split("b", "t", "a"), panes, (id) => agents[id] as never);

  it("captures sizes, the page and what each terminal runs", () => {
    expect((saved.template as { sizes: number[] }).sizes).toEqual([60, 25, 15]);
    expect(saved.slotTypes).toEqual([
      { type: "browser", url: "http://localhost:3000/courts", filePath: undefined },
      { type: "terminal", url: undefined, filePath: undefined, cliType: "shell" },
      {
        type: "terminal",
        url: undefined,
        filePath: undefined,
        cliType: "claude-code",
        model: "opus",
        yolo: true,
        accessMode: "write",
      },
    ]);
    expect(describeLayout({ ...saved, id: "x", name: "tennis", createdAt: 0 })).toBe(
      "browser · terminal · claude-code",
    );
  });

  it("in a new tab, its blank pane and the new ones take the slots; terminals are spawned", () => {
    const custom = { ...saved, id: "x", name: "tennis", createdAt: 0 };
    const out = computeCustomPresetTransformation(custom, ["blank"], (id) => id === "blank");
    expect(out.newPanes[0]).toEqual({
      id: "blank",
      type: "browser",
      url: "http://localhost:3000/courts",
      filePath: undefined,
    });
    expect(out.newPanes.slice(1).map((p) => p.type)).toEqual(["empty", "empty"]);
    expect(out.spawns.map((s) => s.slot.cliType)).toEqual(["shell", "claude-code"]);
  });

  it("panes already showing something keep it", () => {
    const custom = { ...saved, id: "x", name: "tennis", createdAt: 0 };
    const out = computeCustomPresetTransformation(custom, ["busy"], () => false);
    expect(out.newPanes.map((p) => p.id)).not.toContain("busy");
  });
});
