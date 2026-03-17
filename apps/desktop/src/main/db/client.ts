import { join } from "node:path";
import { app } from "electron";
import Database from "libsql";
import { runMigrations } from "./migrations";

let db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (!db) {
    throw new Error("Database not initialized. Call initializeDatabase() first.");
  }
  return db;
}

export async function initializeDatabase(): Promise<Database.Database> {
  if (db) return db;

  const dbPath = join(app.getPath("userData"), "exegol.db");
  db = new Database(dbPath);

  // Enable WAL mode for better concurrent read/write performance
  db.pragma("journal_mode = WAL");
  db.pragma("busy_timeout = 5000");
  db.pragma("synchronous = NORMAL");
  db.pragma("foreign_keys = ON");

  runMigrations(db);

  return db;
}

export function closeDatabase(): void {
  if (db) {
    db.close();
    db = null;
  }
}
