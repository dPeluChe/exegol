import type { Agent, AgentProvider } from "@exegol/shared";
import { describe, expect, it, vi } from "vitest";

let finishStop: () => void = () => {};
vi.mock("../lib/trpc-client", () => ({
  trpcInvoke: vi.fn(async () => []),
  trpcMutate: vi.fn(async (path: string) => {
    if (path === "agents.stop") await new Promise<void>((r) => (finishStop = r));
  }),
}));

const { onceAtATime, resumableFrom, resumeSessionInto } = await import("./use-resume-agent");
const { deleteAgent } = await import("./use-delete-agent");

describe("onceAtATime", () => {
  it("a second resume of the same session, while the first runs or after it, does nothing", async () => {
    const fn = vi.fn(() => new Promise<void>((r) => setTimeout(r, 5)));
    await Promise.all([onceAtATime("s1", fn), onceAtATime("s1", fn)]);
    await onceAtATime("s1", fn);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("a failed resume can be tried again", async () => {
    let calls = 0;
    const failing = async () => {
      calls++;
      throw new Error("spawn failed");
    };
    await expect(onceAtATime("s2", failing)).rejects.toThrow();
    await expect(onceAtATime("s2", failing)).rejects.toThrow();
    expect(calls).toBe(2);
  });
});

describe("resumeSessionInto", () => {
  it("waits for a close's stop of the same session before it spawns (Reopen)", async () => {
    deleteAgent("closed");
    const spawn = vi.fn(async () => ({ id: "" }) as Agent);
    const source = { id: "closed", projectId: "P", cliType: "claude-code" as const };
    const resuming = resumeSessionInto(
      { ...source, taskDescription: "", branchName: null },
      true,
      spawn,
    );
    await new Promise((r) => setTimeout(r, 5));
    expect(spawn).not.toHaveBeenCalled();
    finishStop();
    await resuming;
    expect(spawn).toHaveBeenCalledTimes(1);
  });
});

describe("resumableFrom", () => {
  it("only providers that resume and are installed", () => {
    const p = (id: string, supportsResume: boolean, installed: boolean) =>
      ({ id, capabilities: { supportsResume }, installed }) as unknown as AgentProvider;
    const got = resumableFrom([p("a", true, true), p("b", false, true), p("c", true, false)]);
    expect([...got]).toEqual(["a"]);
  });
});
