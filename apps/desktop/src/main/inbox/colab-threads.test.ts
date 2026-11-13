import { type InboxThread, inboxPendingState } from "@exegol/shared";
import Database from "libsql";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { runMigrations } from "../db/migrations";
import { addColabMember, createColab, removeColabMember } from "../db/queries/colabs";
import { countActiveThreads, getThread, listThreads } from "../db/queries/inbox";
import { callInboxTool } from "../mcp/exegol-inbox-tools";
import { sendToSession } from "./send-to-session";
import { sessionLine } from "./session-line";
import { close, keepOpen, openThread, PERSON, readThread, replyTo } from "./threads";

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

  it("close by agreement: the other side proposes, the opener's confirms or answers", async () => {
    const irma = agent("a-irma", "irma");
    const target = { scope: "colab", colabId: colab, toProject: "blue" } as const;
    const { thread } = openThread(db, irma, target, fields);
    const now = () => getThread(db, thread.id, null) as InboxThread;
    const propose = () => close(db, blue, thread.id, "resolved", "Fixed in PR 75");

    const proposed = await callInboxTool(
      db,
      "inbox_close",
      { thread: thread.id, status: "resolved", resolution: "Fixed in PR 75" },
      context("a-blue", "blue"),
    );
    expect(proposed).toMatchObject({ status: "awaiting_confirmation", proposed: "resolved" });
    expect(now()).toMatchObject({ status: "open", closing: "resolved", resolution: null });
    expect(inboxPendingState(now())).toBe("to_confirm");
    expect(countActiveThreads(db, "irma")).toBe(1);

    replyTo(db, blue, thread.id, "Also bumped the version");
    expect(now().closing).toBe("resolved");
    replyTo(db, irma, thread.id, "Three files still to bring");
    expect(now()).toMatchObject({ status: "open", closing: null, closingLine: null });
    expect(countActiveThreads(db, "irma")).toBe(0);
    expect(readThread(db, PERSON, thread.id, 0).messages.map((m) => m.body)).toContain(
      "Proposes to close as resolved: Fixed in PR 75",
    );

    expect(propose()).toBe("proposed");
    keepOpen(db, thread.id);
    expect(now().closing).toBeNull();

    expect(propose()).toBe("proposed");
    expect(close(db, irma, thread.id, "resolved", "files synced")).toBe("closed");
    expect(now()).toMatchObject({
      status: "resolved",
      closing: null,
      resolution: "Fixed in PR 75 / files synced",
    });
  });

  it("let a person close over a proposal with their own status, or leave a member that left out", () => {
    const irma = agent("a-irma", "irma");
    const target = { scope: "colab", colabId: colab, toProject: "blue" } as const;
    const first = openThread(db, irma, target, fields).thread;
    close(db, blue, first.id, "resolved", "Fixed");
    close(db, PERSON, first.id, "dismissed", "");
    expect(getThread(db, first.id, null)).toMatchObject({
      status: "dismissed",
      resolution: "Fixed",
    });

    const second = openThread(db, irma, target, { ...fields, title: "Another one" }).thread;
    removeColabMember(db, colab, "irma", "lizaceves-landing");
    expect(close(db, blue, second.id, "resolved", "Fixed")).toBe("closed");
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

  it("list a session its colabs with each member's role", async () => {
    const listed = await callInboxTool(db, "colabs_list", {}, context("a-irma", "irma"));
    expect(listed).toMatchObject({
      colabs: [
        {
          colab: "Landings",
          members: [
            { project: "Blueprints", role: "main dev", note: "blueprint" },
            { project: "Irma Projects", role: "user dev", you: true },
          ],
        },
      ],
    });
  });

  it("take the only colab, or the other member's name, and say where the thread landed", async () => {
    const irma = context("a-irma", "irma");
    const first = await callInboxTool(db, "inbox_post", { target: "colab", ...fields }, irma);
    expect(first).toMatchObject({ scope: "colab", colab: "Landings" });
    expect((first as { seen_by: string }).seen_by).toContain("Blueprints");

    const named = { target: "colab", colab: "blueprints", ...fields };
    expect(await callInboxTool(db, "inbox_post", named, irma)).toMatchObject({
      colab: "Landings",
      to_project: "Blueprints",
    });
  });

  it("are listed alone with the colab filter, and count only where they are for", async () => {
    const irma = context("a-irma", "irma");
    const post = (args: object) =>
      callInboxTool(db, "inbox_post", { ...fields, ...args }, irma) as Promise<{ thread: string }>;
    const forAll = await post({ target: "colab" });
    const forBlue = await post({ target: "colab", to_project: "Blueprints" });
    await post({});

    const listed = (await callInboxTool(db, "inbox_list", { colab: "Landings" }, irma)) as {
      threads: { thread: string; colab: string }[];
    };
    expect(listed.threads.map((t) => [t.thread, t.colab])).toEqual([
      [forBlue.thread, "Landings"],
      [forAll.thread, "Landings"],
    ]);
    expect(countActiveThreads(db, "irma")).toBe(2);
    expect(countActiveThreads(db, "blue")).toBe(2);
  });

  it("tell a starting session its colab, purpose, the other members and who is the main one", async () => {
    const line = await sessionLine(db, "irma");
    expect(line).toContain(
      'colab "Landings" with Blueprints (labs-landings-base), blueprint, main dev, makes the changes.',
    );
    expect(line).toContain("Purpose: Blueprint fixes from its clones");
    expect(line).toContain("This project is a user dev");
    const blue = await sessionLine(db, "blue");
    expect(blue).toContain("This project is its main dev");
    expect(blue).toContain("clone, user dev, uses it and reports");
    expect(await sessionLine(db, "out")).toBe("");
  });
});
