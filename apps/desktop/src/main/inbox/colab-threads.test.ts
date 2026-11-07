import Database from "libsql";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { runMigrations } from "../db/migrations";
import { addColabMember, createColab, removeColabMember } from "../db/queries/colabs";
import { getThread, listThreads } from "../db/queries/inbox";
import { callInboxTool } from "../mcp/exegol-inbox-tools";
import { sendToSession } from "./send-to-session";
import { sessionLine } from "./session-line";
import { openThread, PERSON, readThread, replyTo } from "./threads";

vi.mock("../agents/follow-up-queue", () => ({
  FOLLOW_UP_MAX_CHARS: 12_000,
  queueFollowUp: () => ({ id: "m1", delivered: true }),
}));

let db: Database.Database;
let colab: string;

const agent = (agentId: string, projectId: string) => ({
  ...PERSON,
  authorKind: "agent" as const,
  agentId,
  projectId,
});
const blue = agent("a-blue", "blue");
const outsider = agent("a-out", "out");
const fields = { title: "Fix the hero", body: "The clone found it", url: null, refs: [] };
const context = (agentId: string, projectId: string) =>
  ({ agentId, projectId, accessMode: "write" }) as Parameters<typeof callInboxTool>[3];

beforeEach(() => {
  db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  runMigrations(db);
  for (const [id, name] of [
    ["blue", "Blueprints"],
    ["irma", "Irma Projects"],
    ["out", "Other"],
  ]) {
    db.prepare("INSERT INTO projects (id, name, path) VALUES (?, ?, ?)").run(id, name, `/x/${id}`);
  }
  for (const [id, project] of [
    ["a-blue", "blue"],
    ["a-irma", "irma"],
    ["a-out", "out"],
  ]) {
    db.prepare(
      "INSERT INTO agents (id, project_id, cli_type, task_description, status) VALUES (?, ?, 'claude-code', 't', 'running')",
    ).run(id, project);
  }
  colab = createColab(db, "Landings", "Blueprint fixes from its clones");
  addColabMember(db, colab, { projectId: "blue", repo: "labs-landings-base", role: "blueprint" });
  addColabMember(db, colab, { projectId: "irma", repo: "lizaceves-landing", role: "clone" });
});

describe("colab threads", () => {
  it("reach the members only, and count on the project they are for", () => {
    const target = { scope: "colab", colabId: colab, toProject: "irma" } as const;
    const { thread } = openThread(db, blue, target, fields);

    expect(thread.ownerProject).toBe("irma");
    expect(getThread(db, thread.id, "irma")).not.toBeNull();
    expect(getThread(db, thread.id, "out")).toBeNull();
    expect(() => replyTo(db, outsider, thread.id, "me too")).toThrow("No inbox thread");
    expect(() => openThread(db, outsider, target, fields)).toThrow("not in that colab");
    expect(sendToSession(db, thread.id, "a-irma")).toEqual({ delivered: true });
    expect(() => sendToSession(db, thread.id, "a-out")).toThrow("not in the colab");

    removeColabMember(db, colab, "irma", "lizaceves-landing");
    expect(listThreads(db, { projectId: "irma", state: "active", limit: 5 })).toEqual([]);
    expect(() => readThread(db, agent("a-irma", "irma"), thread.id, 0)).toThrow();
  });

  it("are opened by name from inbox_post, and a wrong name lists the right ones", async () => {
    const posted = (await callInboxTool(
      db,
      "inbox_post",
      { target: "colab", colab: "landings", to_project: "irma projects", ...fields },
      context("a-blue", "blue"),
    )) as { thread: string };
    expect(getThread(db, posted.thread, null)?.toProject).toBe("irma");

    await expect(
      callInboxTool(
        db,
        "inbox_post",
        { target: "colab", colab: "Web", ...fields },
        context("a-blue", "blue"),
      ),
    ).rejects.toThrow("Yours: Landings");
    await expect(
      callInboxTool(
        db,
        "inbox_post",
        { target: "colab", colab: "Landings", to_project: "Other", ...fields },
        context("a-blue", "blue"),
      ),
    ).rejects.toThrow("Members: Blueprints, Irma Projects");
  });

  it("tell a starting session its colab, purpose and the other members", () => {
    const line = sessionLine(db, "irma");
    expect(line).toContain('colab "Landings" with Blueprints (labs-landings-base), blueprint.');
    expect(line).toContain("Purpose: Blueprint fixes from its clones");
    expect(sessionLine(db, "out")).toBe("");
  });
});
