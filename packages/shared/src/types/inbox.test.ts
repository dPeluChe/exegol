import { describe, expect, it } from "vitest";
import { type Colab, colabIdsOf } from "./colab";
import { type InboxThread, inboxCountsOn } from "./inbox";

const thread = (id: string, scope: InboxThread["scope"], scopeId: string, toProject = "") =>
  ({ id, scope, scopeId, toProject: toProject || null }) as InboxThread;

const colab = (id: string, ...projects: string[]) =>
  ({ id, name: id, members: projects.map((projectId) => ({ projectId })) }) as Colab;

const colabs = [colab("c1", "a", "b"), colab("c2", "b", "c")];
const threads = [
  thread("t1", "project", "a"),
  thread("t2", "colab", "c1"),
  thread("t3", "colab", "c1", "b"),
  thread("t4", "colab", "c2"),
];

describe("inboxCountsOn", () => {
  const counted = (projectId: string) =>
    threads
      .filter((t) => inboxCountsOn(t, projectId, colabIdsOf(colabs, projectId)))
      .map((t) => t.id);

  it("counts a thread for the whole colab on each member, one for a member only there", () => {
    expect(counted("a")).toEqual(["t1", "t2"]);
    expect(counted("b")).toEqual(["t2", "t3", "t4"]);
    expect(counted("c")).toEqual(["t4"]);
  });

  it("leaves out a colab the project is not in", () => {
    expect(counted("d")).toEqual([]);
  });
});
