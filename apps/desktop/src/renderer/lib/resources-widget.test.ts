import { describe, expect, it } from "vitest";
import { formatGb, ramText, resourcesTooltip } from "./resources-widget";
import { resolveWidgetLayout, updateWidget, widgetMode } from "./status-bar-widgets";

const GB = 1024 ** 3;
const metrics = {
  cpu: { usage: 61.4, cores: 10, model: "M1" },
  memory: { total: 32 * GB, used: 22.4 * GB, free: 9.6 * GB, usagePercent: 70 },
  usage: {
    exegolCpu: 4.2,
    exegolMemory: 1.1 * GB,
    agentsCpu: 7.6,
    agentsMemory: 2 * GB,
    agentProcesses: 5,
  },
};

describe("formatGb", () => {
  it("one decimal, no trailing .0", () => {
    expect(formatGb(22.4 * GB)).toBe("22.4");
    expect(formatGb(32 * GB)).toBe("32");
    expect(formatGb(0.04 * GB)).toBe("0");
    expect(formatGb(3.06 * GB)).toBe("3.1");
  });
});

describe("ramText", () => {
  it("percent mode rounds the percentage", () => {
    expect(ramText({ ...metrics.memory, usagePercent: 69.6 }, "percent")).toBe("70%");
  });
  it("values mode shows used/total GB", () => {
    expect(ramText(metrics.memory, "values")).toBe("22.4/32 GB");
  });
});

describe("resourcesTooltip", () => {
  it("names the machine, then Exegol and its agents, then the RAM note", () => {
    const lines = resourcesTooltip(metrics, true).split("\n");
    expect(lines[0]).toBe("This Mac: CPU 61% · RAM 22.4 of 32 GB used (70%)");
    expect(lines[1]).toBe("Exegol and its agents: CPU 12% · RAM 3.1 GB");
    expect(lines[2]).toMatch(/swap/);
  });
  it("skips the Exegol line before the first process reading", () => {
    expect(resourcesTooltip({ ...metrics, usage: null }, "This machine").split("\n")).toHaveLength(
      2,
    );
  });
});

describe("resources widget mode", () => {
  it("defaults to percent and keeps a saved mode", () => {
    expect(widgetMode(resolveWidgetLayout([]), "resources")).toBe("percent");
    const saved = resolveWidgetLayout([
      { id: "resources", on: true, slot: "right", mode: "values" },
    ]);
    expect(widgetMode(saved, "resources")).toBe("values");
    expect(widgetMode(updateWidget(saved, "resources", { mode: "percent" }), "resources")).toBe(
      "percent",
    );
  });
});
