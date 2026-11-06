import Database from "libsql";

export function withReadonlyDb<T>(path: string, read: (db: Database.Database) => T): T {
  const db = new Database(path, { readonly: true, fileMustExist: true });
  try {
    return read(db);
  } finally {
    db.close();
  }
}
