import { DEFAULT_SETTINGS, type Settings } from "@exegol/shared";
import type Database from "libsql";

export function getAppSettings(db: Database.Database): Settings {
  try {
    const row = db.prepare("SELECT value FROM settings WHERE key = 'app_settings'").get() as
      | { value: string }
      | undefined;
    // Merge with defaults so fields added after the row was written are present
    return row ? { ...DEFAULT_SETTINGS, ...JSON.parse(row.value) } : { ...DEFAULT_SETTINGS };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveAppSettings(db: Database.Database, settings: Settings): void {
  db.prepare(
    `INSERT INTO settings (key, value) VALUES ('app_settings', ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  ).run(JSON.stringify(settings));
}

/** A JSON value under its own settings key (per-project maps: ports, run pins) */
export function getJsonSetting<T>(db: Database.Database, key: string, fallback: T): T {
  const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(key) as
    | { value: string }
    | undefined;
  if (!row) return fallback;
  try {
    return JSON.parse(row.value) as T;
  } catch {
    return fallback;
  }
}

export function setJsonSetting(db: Database.Database, key: string, value: unknown): void {
  db.prepare(
    "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  ).run(key, JSON.stringify(value));
}
