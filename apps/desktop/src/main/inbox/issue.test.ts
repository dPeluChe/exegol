import Database from "libsql";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { runMigrations } from "../db/migrations";
import { getThread, listMessages } from "../db/queries/inbox";
import { sendAsIssue } from "./issue";
import { openThread, PERSON } from "./threads";

const URL = "https://github.com/acme/landing/issues/7";
vi.mock("../integrations/github/repos", () => ({
  projectRepos: async () => [{ name: "acme/landing", folder: "", path: "/x/p1" }],
}));
vi.mock("../integrations/github/gh", () => ({
  ghSignedIn: async () => true,
  ghCreateIssue: async () => URL,
}));

let db: Database.Database;
const fields = { repo: "acme/landing", title: "T", body: "B" };
const open = (target: { scope: "project"; projectId: string } | { scope: "personal" }) =>
  openThread(db, PERSON, target, { title: "Hero", body: "b", url: null, refs: [] }).thread.id;

beforeEach(() => {
  db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  runMigrations(db);
  db.prepare("INSERT INTO projects (id, name, path) VALUES ('p1', 'Proj', '/x/p1')").run();
});

describe("sendAsIssue", () => {
  it("files only on a repo of the project, and links the thread", async () => {
    const key = open({ scope: "project", projectId: "p1" });
    await expect(sendAsIssue(db, key, { ...fields, repo: "evil/repo" })).rejects.toThrow(
      "not a GitHub repo",
    );
    expect(await sendAsIssue(db, key, fields)).toBe(URL);
    expect(getThread(db, key, null)?.url).toBe(URL);
    expect(listMessages(db, key).at(-1)?.body).toBe(`Sent as issue: ${URL}`);
  });

  it("refuses a personal thread, which has no repo", async () => {
    await expect(sendAsIssue(db, open({ scope: "personal" }), fields)).rejects.toThrow(
      "personal thread",
    );
  });
});
