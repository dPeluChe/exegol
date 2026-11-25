import type Database from "libsql";
import { baseMigrations } from "./migration-sets/base";
import { wave2KnowledgeMigrations } from "./migration-sets/wave2-knowledge";
import { wave2SignalMigrations } from "./migration-sets/wave2-signal";
import { wave2SurfaceMigrations } from "./migration-sets/wave2-surface";
import { wave3Migrations } from "./migration-sets/wave3";

export type Migration = {
  id: string;
  sql: string;
};

// Wave 2: each work group appends ONLY to its own migration-sets/ file
// (w2a_/w2b_/w2d_ id prefixes) — this array stays conflict-free.
const migrations: Migration[] = [
  ...baseMigrations,
  ...wave2SignalMigrations,
  ...wave2KnowledgeMigrations,
  ...wave2SurfaceMigrations,
  ...wave3Migrations,
];

export function runMigrations(db: Database.Database): void {
  // Create migration tracking table
  db.exec(`CREATE TABLE IF NOT EXISTS _migrations (
    id TEXT PRIMARY KEY,
    applied_at INTEGER NOT NULL DEFAULT (unixepoch())
  )`);

  const appliedStmt = db.prepare("SELECT id FROM _migrations WHERE id = ?");
  const insertStmt = db.prepare("INSERT INTO _migrations (id) VALUES (?)");

  const runInTransaction = db.transaction(() => {
    for (const migration of migrations) {
      const existing = appliedStmt.get(migration.id) as { id: string } | undefined;
      if (existing) continue;

      db.exec(migration.sql);
      insertStmt.run(migration.id);
    }
  });

  runInTransaction();
}
