import Database from "libsql";
import { beforeEach, describe, expect, it } from "vitest";
import { runMigrations } from "../migrations";
import { addColabMember, createColab, deleteColab, listColabs, removeColabMember } from "./colabs";

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

    expect(listColabs(db)[0]?.members).toEqual([
      { projectId: "blue", projectName: "blue", repo: "labs-landings-base", role: "blueprint" },
      { projectId: "irma", projectName: "irma", repo: "lizaceves-landing", role: "clone of it" },
    ]);

    removeColabMember(db, id, "irma", "lizaceves-landing");
    db.prepare("DELETE FROM projects WHERE id = 'blue'").run();
    expect(listColabs(db)[0]?.members).toEqual([]);

    deleteColab(db, id);
    expect(listColabs(db)).toEqual([]);
  });

  it("refuses a second colab with the same name in any case", () => {
    createColab(db, "Landings", "");
    expect(() => createColab(db, "landings", "")).toThrow(/UNIQUE/);
  });
});
