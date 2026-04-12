/**
 * DB connection for the CLI. Reads the same SQLite database that the
 * Electron app uses. Path resolution follows Electron's app.getPath
 * convention: ~/Library/Application Support/Exegol/exegol.db on macOS.
 */

import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import Database from "libsql";

function resolveDbPath(): string {
  const platform = process.platform;
  let appDataDir: string;

  if (platform === "darwin") {
    appDataDir = join(homedir(), "Library", "Application Support", "Exegol");
  } else if (platform === "win32") {
    appDataDir = join(process.env.APPDATA ?? join(homedir(), "AppData", "Roaming"), "Exegol");
  } else {
    appDataDir = join(process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"), "Exegol");
  }

  return join(appDataDir, "exegol.db");
}

let dbInstance: Database.Database | null = null;

export function getDb(): Database.Database {
  if (dbInstance) return dbInstance;
  const dbPath = resolveDbPath();
  if (!existsSync(dbPath)) {
    console.error(`Database not found at: ${dbPath}`);
    console.error("Is Exegol running? The database is created on first launch.");
    process.exit(1);
  }
  dbInstance = new Database(dbPath, { readonly: true });
  return dbInstance;
}

export function closeDb(): void {
  dbInstance?.close();
  dbInstance = null;
}
