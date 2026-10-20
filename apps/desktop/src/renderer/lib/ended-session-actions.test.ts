import { beforeEach, describe, expect, it, vi } from "vitest";

const calls: string[] = [];
const replaceAgent = vi.fn();
const deleteAgent = vi.fn((id: string) => calls.push(`delete:${id}`));
const setPaneIn = vi.fn((..._args: unknown[]) => true);

vi.mock("../hooks/use-delete-agent", () => ({ deleteAgent }));
vi.mock("../hooks/use-resume-agent", () => ({ setPaneIn }));
vi.mock("../stores/watch", () => ({
  useWatchStore: {
    getState: () => ({
      replaceAgent: (a: string, b: string) => {
        calls.push(`pin:${a}->${b}`);
        replaceAgent(a, b);
      },
    }),
  },
}));
vi.mock("../stores/agents", () => ({
  toAgentState: (a: unknown) => a,
  useAgentStore: { getState: () => ({ addAgent: vi.fn() }) },
}));
vi.mock("../stores/terminals", () => ({
  useTerminalStore: { getState: () => ({ createTerminal: vi.fn() }) },
}));
vi.mock("./pane-focus", () => ({ focusNewPane: vi.fn(), dropPaneFocus: vi.fn() }));
vi.mock("./project-browser-url", () => ({
  projectBrowserUrl: async () => "http://localhost:3000",
}));
vi.mock("./trpc-client", () => ({ trpcMutate: vi.fn(async () => ({ id: "new1" })) }));

const { filesInPane, newSessionInPane, browserInPane } = await import("./ended-session-actions");
const source = { id: "old1", projectId: "P", cliType: "claude-code" as const };

beforeEach(() => {
  calls.length = 0;
  vi.clearAllMocks();
  setPaneIn.mockImplementation(() => true);
});

describe("ended session actions", () => {
  it("a new session takes over the Watching pin before the old row retires", async () => {
    await newSessionInPane(source, "pane1");
    expect(calls).toEqual(["pin:old1->new1", "delete:old1"]);
  });

  it("a new session starts in the session's folder, unless it had a worktree branch", async () => {
    const { trpcMutate } = await import("./trpc-client");
    await newSessionInPane(source, "pane1", "/p/app/web");
    expect(trpcMutate).toHaveBeenLastCalledWith(
      "agents.spawn",
      expect.objectContaining({ cwdOverride: "/p/app/web", useWorktree: false }),
    );
    await newSessionInPane({ ...source, branchName: "exegol/x" }, "pane1", "/wt/x");
    expect(trpcMutate).toHaveBeenLastCalledWith(
      "agents.spawn",
      expect.not.objectContaining({ cwdOverride: expect.anything() }),
    );
  });

  it("Files clears the pane's agent so the retire does not empty it", () => {
    filesInPane(source, "pane1", "/p/app/web");
    expect(setPaneIn).toHaveBeenCalledWith("P", "pane1", {
      type: "files",
      agentId: undefined,
      filePath: "/p/app/web",
      openFile: undefined,
    });
    expect(deleteAgent).toHaveBeenCalledWith("old1");
  });

  it("a pane gone meanwhile keeps the ended row and stops the new agent", async () => {
    setPaneIn.mockImplementation(() => false);
    await newSessionInPane(source, "gone");
    expect(replaceAgent).not.toHaveBeenCalled();
    expect(calls).toEqual(["delete:new1"]);
    await browserInPane(source, "/p/app", "gone");
    expect(deleteAgent).not.toHaveBeenCalledWith("old1");
  });
});
