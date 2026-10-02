import { describe, expect, it, vi } from "vitest";

vi.mock("./spawn-env", () => ({ broadcastAgentStatus: vi.fn() }));
vi.mock("./output-pipeline", () => ({
  attachOutputPipeline: vi.fn(),
  detachOutputPipeline: vi.fn(),
}));

const { planShellTransitions } = await import("./shell-promotion");

const shell = {
  id: "s1",
  pid: 100,
  projectId: "p1",
  cliType: "shell",
  status: "running" as const,
  currentStep: null,
  alias: null,
  launchedInShell: false,
};
const parsing = (ids: string[]) => (id: string) => ids.includes(id);

describe("planShellTransitions", () => {
  it("promotes a plain terminal when any provider's CLI runs below it", () => {
    expect(planShellTransitions([shell], { s1: "codex" }, parsing([]))).toEqual([
      { id: "s1", kind: "promote", cliType: "codex" },
    ]);
  });

  it("leaves a plain terminal alone while nothing runs", () => {
    expect(planShellTransitions([shell], {}, parsing([]))).toEqual([]);
  });

  it("does nothing while the promoted CLI keeps running", () => {
    const agent = { ...shell, cliType: "claude-code", launchedInShell: true };
    expect(planShellTransitions([agent], { s1: "claude-code" }, parsing(["s1"]))).toEqual([]);
  });

  it("goes back to the prompt when the CLI exits, and stays an agent", () => {
    const agent = { ...shell, cliType: "claude-code", launchedInShell: true };
    expect(planShellTransitions([agent], {}, parsing(["s1"]))).toEqual([
      { id: "s1", kind: "prompt" },
    ]);
    // Already at the prompt: no repeated transition
    expect(planShellTransitions([agent], {}, parsing([]))).toEqual([]);
  });

  it("switches to another CLI started in the same terminal, or the same one again", () => {
    const agent = { ...shell, cliType: "claude-code", launchedInShell: true };
    expect(planShellTransitions([agent], { s1: "gemini" }, parsing(["s1"]))).toEqual([
      { id: "s1", kind: "promote", cliType: "gemini" },
    ]);
    expect(planShellTransitions([agent], { s1: "claude-code" }, parsing([]))).toEqual([
      { id: "s1", kind: "promote", cliType: "claude-code" },
    ]);
  });

  it("ignores a provider id that is not a known CLI type", () => {
    expect(planShellTransitions([shell], { s1: "my-custom" }, parsing([]))).toEqual([]);
  });
});
