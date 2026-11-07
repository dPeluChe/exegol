import { join } from "node:path";
import type { NoteScope } from "@exegol/shared";
import type Database from "libsql";
import { EXEGOL_DIR } from "../mcp/exegol-protocol";

export const notesRoot = () => join(EXEGOL_DIR, "notes");

export type NotesPlace =
  | { scope: "project"; projectId: string }
  | { scope: "colab"; colabId: string }
  | { scope: "personal" };

export interface NotesFolder {
  scope: NoteScope;
  /** Absolute, for the files */
  dir: string;
  /** Home-relative, for what an agent or a log line is told */
  shown: string;
  name: string;
}

const SLUG_MAX = 60;

export function folderSlug(name: string, fallback: string): string {
  const slug = name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, SLUG_MAX)
    .replace(/-+$/, "");
  return slug || fallback;
}

const TABLES = { project: "projects", colab: "colabs" } as const;

/** Named on the first write and stored, so a rename keeps the folder; reads never name one */
function folderOf(
  db: Database.Database,
  kind: "project" | "colab",
  id: string,
  claim: boolean,
): NotesFolder | null {
  const table = TABLES[kind];
  const row = db.prepare(`SELECT name, notes_dir FROM ${table} WHERE id = ?`).get(id) as
    | { name: string; notes_dir: string | null }
    | undefined;
  if (!row) return null;
  let dir = row.notes_dir;
  if (!dir && !claim) return null;
  if (!dir) {
    const base = folderSlug(row.name, kind);
    const taken = db.prepare(`SELECT 1 FROM ${table} WHERE notes_dir = ? AND id <> ?`);
    dir = base;
    for (let n = 2; taken.get(dir, id); n++) dir = `${base}-${n}`;
    db.prepare(`UPDATE ${table} SET notes_dir = ? WHERE id = ?`).run(dir, id);
  }
  return {
    scope: kind,
    dir: join(notesRoot(), table, dir),
    shown: `~/.exegol/notes/${table}/${dir}`,
    name: row.name,
  };
}

/** null: the project or colab is gone, or (without `claim`) has no notes yet */
export function notesFolder(
  db: Database.Database,
  place: NotesPlace,
  claim = false,
): NotesFolder | null {
  if (place.scope === "project") return folderOf(db, "project", place.projectId, claim);
  if (place.scope === "colab") return folderOf(db, "colab", place.colabId, claim);
  return {
    scope: "personal",
    dir: join(notesRoot(), "personal"),
    shown: "~/.exegol/notes/personal",
    name: "Personal",
  };
}
