import { describe, expect, it, vi } from "vitest";

vi.mock("../trpc-client", () => ({
  trpcInvoke: vi.fn(async () => null),
  trpcMutate: vi.fn(async () => ({})),
}));

const { appFocusChanged } = await import("./controller");
const { useDictationStore } = await import("../../stores/dictation");
const { useToastStore } = await import("../../stores/toasts");
const { confirmTarget, resolveTarget } = await import("./target");

describe("app focus while dictating", () => {
  it("leaving Exegol and coming back never cancels a recording", () => {
    for (const phase of ["starting", "listening", "transcribing"] as const) {
      useDictationStore.getState().set({ phase, sessionId: "s1", partial: "narrating" });
      appFocusChanged(false);
      appFocusChanged(true);
      expect(useDictationStore.getState()).toMatchObject({ phase, partial: "narrating" });
    }
    expect(useToastStore.getState().toasts).toHaveLength(0);
  });

  it("returning to the same pane inserts there; another pane in Exegol copies instead", () => {
    const base = {
      activeView: "workspace",
      projectId: "p1",
      focusedPaneId: "pane1",
      pane: { id: "pane1", type: "terminal", agentId: "a1" },
      sessionLive: true,
      editableField: false,
    };
    const start = resolveTarget(base);
    // Away in another app, the workspace's focused pane does not change
    expect(confirmTarget(start, resolveTarget(base))).toBe(start);
    const moved = resolveTarget({
      ...base,
      focusedPaneId: "pane2",
      pane: { id: "pane2", type: "browser" },
    });
    expect(confirmTarget(start, moved)).toMatchObject({ kind: "clipboard" });
    // The session ended while the user was away
    expect(confirmTarget(start, resolveTarget({ ...base, sessionLive: false })).kind).toBe(
      "clipboard",
    );
  });
});
