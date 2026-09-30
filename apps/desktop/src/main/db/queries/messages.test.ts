import Database from "libsql";
import { describe, expect, it } from "vitest";
import { runMigrations } from "../migrations";
import { listMessages, markMessageRead, sendMessage, setMessageDeliveryState } from "./messages";

function setupDb() {
  const db = new Database(":memory:");
  runMigrations(db);
  db.prepare("INSERT INTO projects (id, name, path) VALUES ('p1', 'Proj', '/tmp/p1')").run();
  for (const id of ["a", "b", "c"]) {
    db.prepare(
      "INSERT INTO agents (id, project_id, cli_type, status, task_description) VALUES (?, 'p1', 'claude-code', 'running', '')",
    ).run(id);
  }
  return db;
}

describe("listMessages for an agent's thread", () => {
  it("lists what it sent and received, each with its delivery state", () => {
    const db = setupDb();
    const out = sendMessage(db, { fromAgentId: "a", toAgentId: "b", type: "text", content: "hi" });
    sendMessage(db, { fromAgentId: "b", toAgentId: "a", type: "result", content: "done" });
    sendMessage(db, { fromAgentId: "b", toAgentId: "c", type: "text", content: "not a's" });
    setMessageDeliveryState(db, out.id, "consumed");

    const thread = listMessages(db, { agentId: "a" });
    expect(thread.map((m) => m.content).sort()).toEqual(["done", "hi"]);
    expect(thread.find((m) => m.id === out.id)?.deliveryState).toBe("consumed");
  });

  it("unreadOnly keeps what the receiver has not pulled yet", () => {
    const db = setupDb();
    const m1 = sendMessage(db, { fromAgentId: "a", toAgentId: "b", type: "text", content: "1" });
    sendMessage(db, { fromAgentId: "a", toAgentId: "b", type: "text", content: "2" });
    markMessageRead(db, m1.id);
    expect(listMessages(db, { agentId: "b", unreadOnly: true }).map((m) => m.content)).toEqual([
      "2",
    ]);
  });
});
