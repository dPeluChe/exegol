import { type Colab, type InboxThread, inboxCountsOn } from "@exegol/shared";
import { describe, expect, it } from "vitest";
import { colabIdsOf, colabsOf, inboxTabs, shownTab } from "./inbox-menu";

const thread = (id: string, scope: InboxThread["scope"], scopeId: string | null, to = null) =>
  ({ id, scope, scopeId, toProject: to as string | null }) as InboxThread;

const colab = (id: string, ...projects: string[]) =>
  ({ id, name: id, members: projects.map((projectId) => ({ projectId })) }) as Colab;

const colabs = [colab("c1", "a", "b"), colab("c2", "b", "c")];
const threads = [
  thread("t1", "project", "a"),
  thread("t2", "colab", "c1"),
  thread("t3", "colab", "c1", "b" as never),
  thread("t4", "colab", "c2"),
  thread("t5", "personal", null),
];

describe("inboxTabs", () => {
  it("gives the project, each of its colabs and Personal their own threads", () => {
    const tabs = inboxTabs(threads, "a", "A", colabsOf(colabs, "a"));
    expect(tabs.map((t) => [t.key, t.threads.map((x) => x.id)])).toEqual([
      ["project", ["t1"]],
      ["c1", ["t2", "t3"]],
      ["personal", ["t5"]],
    ]);
  });
});

describe("shownTab", () => {
  const tabs = inboxTabs(threads.slice(1), "a", "A", colabsOf(colabs, "a"));

  it("opens on the first inbox with threads", () => {
    expect(shownTab(tabs, null).key).toBe("c1");
  });

  it("keeps the picked one, and falls back when it is gone", () => {
    expect(shownTab(tabs, "personal").key).toBe("personal");
    expect(shownTab(tabs, "c9").key).toBe("c1");
    expect(shownTab(inboxTabs([], "a", "A", []), null).key).toBe("project");
  });
});

describe("inboxCountsOn", () => {
  const counted = (projectId: string) =>
    threads
      .filter((t) => inboxCountsOn(t, projectId, colabIdsOf(colabs, projectId)))
      .map((t) => t.id);

  it("counts a thread for the whole colab on every member, one for a member only there", () => {
    expect(counted("a")).toEqual(["t1", "t2"]);
    expect(counted("b")).toEqual(["t2", "t3", "t4"]);
    expect(counted("c")).toEqual(["t4"]);
  });
});
