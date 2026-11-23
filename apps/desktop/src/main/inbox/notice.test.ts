import Database from "libsql";
import { beforeEach, describe, expect, it } from "vitest";
import { runMigrations } from "../db/migrations";
import { addColabMember, createColab, setColabNotify } from "../db/queries/colabs";
import { type ColabNews, listColabNews, markNoticed } from "../db/queries/inbox";
import { capture } from "./capture";
import {
  mayNotice,
  NOTICE_AGENT_TURNS,
  NOTICE_GAP_MS,
  noticeTargets,
  noticeText,
  PERSON_AWAY_MS,
} from "./notice";
import { close, openThread, PERSON, readThread, replyTo } from "./threads";

const agent = (agentId: string, projectId: string) => ({
  ...PERSON,
  authorKind: "agent" as const,
  agentId,
  projectId,
});
const blue = agent("a-blue", "blue");
const irma = agent("a-irma", "irma");
const fields = { title: "Fix the hero", body: "The clone found it", url: null, refs: [] };

describe("colab news", () => {
  let db: Database.Database;
  let colab: string;
  const forProjects = () => listColabNews(db, NOTICE_AGENT_TURNS).map((n) => n.projectId);

  beforeEach(() => {
    db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
    runMigrations(db);
    for (const id of ["blue", "irma"]) {
      db.prepare("INSERT INTO projects (id, name, path) VALUES (?, ?, ?)").run(id, id, `/x/${id}`);
      db.prepare(
        "INSERT INTO agents (id, project_id, cli_type, task_description, status) VALUES (?, ?, 'claude-code', 't', 'running')",
      ).run(`a-${id}`, id);
    }
    colab = createColab(db, "Landings", "Blueprint fixes");
    for (const projectId of ["blue", "irma"])
      addColabMember(db, colab, { projectId, repo: "", role: "" });
  });

  it("is for the members that did not write it, only in a colab that notifies, once", () => {
    const { thread } = openThread(
      db,
      blue,
      { scope: "colab", colabId: colab, toProject: null },
      fields,
    );
    expect(forProjects()).toEqual([]);
    setColabNotify(db, colab, true);
    expect(forProjects()).toEqual(["irma"]);

    markNoticed(db, listColabNews(db, NOTICE_AGENT_TURNS));
    expect(forProjects()).toEqual([]);

    replyTo(db, irma, thread.id, "On it");
    expect(forProjects()).toEqual(["blue"]);
    readThread(db, blue, thread.id, 0);
    expect(forProjects()).toEqual([]);
  });

  it("reaches the sender of a thread for one project, and only who must agree to a close", () => {
    setColabNotify(db, colab, true);
    const forIrma = { scope: "colab", colabId: colab, toProject: "irma" } as const;
    const { thread } = openThread(db, blue, forIrma, fields);
    expect(forProjects()).toEqual(["irma"]);
    replyTo(db, irma, thread.id, "Done");
    expect(forProjects()).toEqual(["blue"]);

    const whole = openThread(db, blue, { scope: "colab", colabId: colab, toProject: null }, fields);
    replyTo(db, irma, whole.thread.id, "Seen");
    markNoticed(db, listColabNews(db, NOTICE_AGENT_TURNS));
    close(db, blue, whole.thread.id, "resolved", "fixed");
    expect(forProjects()).toEqual(["irma"]);
  });

  it("leaves out what a person captured for review", () => {
    setColabNotify(db, colab, true);
    capture(
      db,
      { scope: "colab", colabId: colab, toProject: null },
      { title: null, text: "A page", url: null, note: null },
    );
    expect(forProjects()).toEqual([]);
  });

  it("stops once agents have answered each other enough, until a person writes", () => {
    setColabNotify(db, colab, true);
    const { thread } = openThread(
      db,
      blue,
      { scope: "colab", colabId: colab, toProject: null },
      fields,
    );
    for (let i = 1; i < NOTICE_AGENT_TURNS; i++) {
      replyTo(db, i % 2 ? irma : blue, thread.id, `reply ${i}`);
    }
    expect(forProjects()).toEqual([]);
    replyTo(db, PERSON, thread.id, "Go on");
    expect(forProjects().sort()).toEqual(["blue", "irma"]);
  });
});

const news = (threadId: number, projectId: string, toSession: string | null = null): ColabNews => ({
  threadId,
  seq: 1,
  colab: threadId > 2 ? "Docs" : "Landings",
  projectId,
  toSession,
});

describe("notices", () => {
  it("go to the session a thread is for while it is live, else to the main one", () => {
    const sessions = [
      { id: "s1", projectId: "irma", alias: "Vega" },
      { id: "s2", projectId: "irma", alias: "Lyra" },
    ];
    const main = (p: string) => (p === "irma" ? "s1" : undefined);
    const out = noticeTargets(
      [news(1, "irma"), news(2, "irma", "lyra"), news(3, "irma", "Gone"), news(4, "blue")],
      sessions,
      main,
    );
    expect([...out].map(([id, list]) => [id, list.map((n) => n.threadId)])).toEqual([
      ["s1", [1, 3]],
      ["s2", [2]],
    ]);
  });

  it("wait for a session at rest, the person away and the gap since the last one", () => {
    const rest = { atPrompt: true, quiet: false, personMs: null, toldMs: null };
    expect(mayNotice(rest)).toBe(true);
    expect(mayNotice({ ...rest, atPrompt: false })).toBe(false);
    expect(mayNotice({ ...rest, quiet: true })).toBe(false);
    expect(mayNotice({ ...rest, personMs: PERSON_AWAY_MS - 1 })).toBe(false);
    expect(mayNotice({ ...rest, personMs: PERSON_AWAY_MS })).toBe(true);
    expect(mayNotice({ ...rest, toldMs: NOTICE_GAP_MS - 1 })).toBe(false);
  });

  it("say how many threads and where, never their words", () => {
    const text = noticeText([news(1, "irma"), news(2, "irma"), news(3, "irma")]);
    expect(text).toBe(
      'Exegol inbox: 2 threads with news in the colab "Landings", 1 thread with news in the colab "Docs". Review with inbox_list when you are free or your current work is done. Keep your conversation\'s language.',
    );
  });
});
