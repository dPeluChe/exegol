import Database from "libsql";
import { beforeEach, describe, expect, it } from "vitest";
import { runMigrations } from "../migrations";
import {
  addColabMember,
  createColab,
  deleteColab,
  listColabs,
  removeColabMember,
  setColabMain,
  setColabMemberRole,
} from "./colabs";

describe("colabs", () => {
  let db: Database.Database;
  beforeEach(() => {
    db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
    runMigrations(db);
    for (const id of ["blue", "irma"]) {
      db.prepare("INSERT INTO projects (id, name, path) VALUES (?, ?, ?)").run(id, id, `/${id}`);
    }
  });

  it("keeps members per repo, updates a role in place and follows deletes", () => {
    const id = createColab(db, "Landings", "Blueprint fixes");
    addColabMember(db, id, { projectId: "blue", repo: "labs-landings-base", role: "blueprint" });
    addColabMember(db, id, { projectId: "irma", repo: "lizaceves-landing", role: "clone" });
    addColabMember(db, id, { projectId: "irma", repo: "lizaceves-landing", role: "clone of it" });

    expect(listColabs(db)[0]?.members).toMatchObject([
      { projectId: "blue", projectName: "blue", repo: "labs-landings-base", role: "blueprint" },
      { projectId: "irma", projectName: "irma", repo: "lizaceves-landing", role: "clone of it" },
    ]);

    removeColabMember(db, id, "irma", "lizaceves-landing");
    db.prepare("DELETE FROM projects WHERE id = 'blue'").run();
    expect(listColabs(db)[0]?.members).toEqual([]);

    deleteColab(db, id);
    expect(listColabs(db)).toEqual([]);
  });

  it("always has one main member: the first to join, the person's pick, the next when it leaves", () => {
    const id = createColab(db, "Landings", "", "irma");
    addColabMember(db, id, { projectId: "blue", repo: "", role: "" });
    const members = () => listColabs(db)[0]?.members.map((m) => [m.projectId, m.main]);
    expect(members()).toEqual([
      ["blue", false],
      ["irma", true],
    ]);
    setColabMain(db, id, "blue", "");
    setColabMain(db, id, "gone", "");
    expect(members()).toEqual([
      ["blue", true],
      ["irma", false],
    ]);
    setColabMemberRole(db, id, { projectId: "irma", repo: "", role: "clone" });
    removeColabMember(db, id, "blue", "");
    expect(listColabs(db)[0]?.members).toMatchObject([
      { projectId: "irma", role: "clone", main: true },
    ]);
  });

  it("refuses a second colab with the same name in any case", () => {
    createColab(db, "Landings", "");
    expect(() => createColab(db, "landings", "")).toThrow(/UNIQUE/);
  });
});
