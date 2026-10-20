import Database from "libsql";
import { beforeEach, describe, expect, it } from "vitest";
import { runMigrations } from "../migrations";
import {
  deleteBrowserPermission,
  listBrowserPermissions,
  saveBrowserPermission,
} from "./browser-permissions";

let db: Database.Database;
beforeEach(() => {
  db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  runMigrations(db);
  db.prepare("INSERT INTO projects (id, name, path) VALUES ('p1', 'Proj', '/repo')").run();
});

describe("browser permissions", () => {
  it("keeps one answer per project, origin and permission", () => {
    saveBrowserPermission(db, "p1", "https://a.test", "geolocation", "allow");
    saveBrowserPermission(db, "p1", "https://a.test", "geolocation", "block");
    saveBrowserPermission(db, "p1", "https://a.test", "camera", "allow");
    const rows = listBrowserPermissions(db, "p1").map((r) => [r.permission, r.decision]);
    expect(rows).toEqual([
      ["camera", "allow"],
      ["geolocation", "block"],
    ]);
  });

  it("forgets one, and all of them with the project", () => {
    saveBrowserPermission(db, "p1", "https://a.test", "geolocation", "allow");
    saveBrowserPermission(db, "p1", "https://b.test", "notifications", "allow");
    expect(deleteBrowserPermission(db, "p1", "https://a.test", "geolocation")).toBe(true);
    expect(deleteBrowserPermission(db, "p1", "https://a.test", "geolocation")).toBe(false);
    db.prepare("DELETE FROM projects WHERE id = 'p1'").run();
    expect(listBrowserPermissions(db, "p1")).toEqual([]);
  });
});
