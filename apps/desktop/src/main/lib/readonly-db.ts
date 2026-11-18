import Database from "libsql";

export function withReadonlyDb<T>(path: string, read: (db: Database.Database) => T): T {
  const db = new Database(path, { readonly: true, fileMustExist: true });
  try {
    return read(db);
  } finally {
    db.close();
  }
}

/** A session row's `title` in a CLI's own database */
export function titleOf(
  db: Database.Database,
  table: "sessions" | "session_v2",
  id: string,
): { title: string | null } {
  const row = db.prepare(`SELECT title FROM ${table} WHERE id = ?`).get(id) as
    | { title: string | null }
    | undefined;
  return { title: row?.title ?? null };
}
