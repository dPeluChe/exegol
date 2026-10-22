import { describe, expect, it, vi } from "vitest";

vi.mock("./spawn-env", () => ({ broadcastAgentStatus: vi.fn() }));
vi.mock("./output-pipeline", () => ({
  attachOutputPipeline: vi.fn(),
  detachOutputPipeline: vi.fn(),
}));

const { needsProcessRead, planShellTransitions, sharedReadAge } = await import("./shell-promotion");

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

describe("needsProcessRead", () => {
  const read = { at: 10_000, ids: new Set(["s1"]) };
  const noInput = () => undefined;

  it("skips a shell at its prompt with no input since the last read", () => {
    expect(needsProcessRead([shell], read, noInput, 13_000)).toBe(false);
    expect(needsProcessRead([shell], read, () => 6_999, 13_000)).toBe(false);
  });

  it("reads one more poll after input: the last read may have landed before the CLI's exec", () => {
    expect(needsProcessRead([shell], read, () => 9_999, 13_000)).toBe(true);
    expect(needsProcessRead([shell], read, () => 7_000, 13_000)).toBe(true);
    expect(needsProcessRead([shell], { ...read, at: 13_000 }, () => 9_999, 16_000)).toBe(false);
  });

  it("reads after input, a foreground command, a promoted CLI or a new session", () => {
    expect(needsProcessRead([shell], read, () => 10_000, 13_000)).toBe(true);
    expect(needsProcessRead([{ ...shell, currentStep: "npm" }], read, noInput, 13_000)).toBe(true);
    expect(
      needsProcessRead(
        [{ ...shell, cliType: "codex", launchedInShell: true }],
        read,
        noInput,
        13_000,
      ),
    ).toBe(true);
    expect(needsProcessRead([{ ...shell, id: "s2" }], read, noInput, 13_000)).toBe(true);
  });

  it("still reads every 30 s", () => {
    expect(needsProcessRead([shell], read, noInput, 40_000)).toBe(true);
  });
});

describe("sharedReadAge", () => {
  it("never takes a read older than the newest input", () => {
    expect(sharedReadAge(0, 100_000)).toBe(1_500);
    expect(sharedReadAge(99_800, 100_000)).toBe(199);
    expect(sharedReadAge(100_000, 100_000)).toBe(0);
  });
});
