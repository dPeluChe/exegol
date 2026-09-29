import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "libsql";
import { describe, expect, it } from "vitest";
import { adoptDetectedIcon } from "./project-icons";

function setup(icon: string | null) {
  const dir = mkdtempSync(join(tmpdir(), "exegol-icon-"));
  writeFileSync(join(dir, "favicon.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  const db = new Database(":memory:");
  db.exec("CREATE TABLE projects (id TEXT, path TEXT, icon TEXT, icon_image TEXT)");
  db.prepare("INSERT INTO projects VALUES ('p', ?, ?, NULL)").run(dir, icon);
  return { db, dir };
}

describe("adoptDetectedIcon", () => {
  it("keeps the first icon found for a project with none", async () => {
    const { db, dir } = setup(null);
    expect(await adoptDetectedIcon(db, "p")).toBe(true);
    const row = db.prepare("SELECT icon_image FROM projects").get() as { icon_image: string };
    expect(row.icon_image).toBe(join(dir, "favicon.png"));
  });

  it("never replaces an icon the user chose", async () => {
    const { db } = setup("rocket");
    expect(await adoptDetectedIcon(db, "p")).toBe(false);
    const row = db.prepare("SELECT icon_image FROM projects").get() as {
      icon_image: string | null;
    };
    expect(row.icon_image).toBeNull();
  });
});
