import Database from "libsql";
import { describe, expect, it } from "vitest";
import { loadActiveView, orderForReattach, saveActiveView } from "./active-view";

describe("active view", () => {
  it("round-trips through settings and reads a missing table as no view", () => {
    const db = new Database(":memory:");
    expect(loadActiveView(db)).toEqual({ projectId: null, agentIds: [] });
    db.exec("CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT)");
    saveActiveView(db, { projectId: "p1", agentIds: ["a", "b"] });
    expect(loadActiveView(db)).toEqual({ projectId: "p1", agentIds: ["a", "b"] });
  });

  it("orders the focused pane, its tab, its project, then the rest", () => {
    const project: Record<string, string> = { a: "p2", b: "p1", c: "p1", d: "p3", e: "p1" };
    const order = orderForReattach(["a", "b", "c", "d", "e"], (id) => project[id], {
      projectId: "p1",
      agentIds: ["e", "missing", "c", "e"],
    });
    expect(order).toEqual({
      ids: ["e", "c", "b", "a", "d"],
      activeTab: ["e", "c"],
      activeProject: 1,
      rest: 2,
    });
  });

  it("keeps the given order with no view", () => {
    const order = orderForReattach(["a", "b"], () => "p1", { projectId: null, agentIds: [] });
    expect(order.ids).toEqual(["a", "b"]);
    expect(order.rest).toBe(2);
  });
});
