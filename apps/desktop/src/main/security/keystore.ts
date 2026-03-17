import { safeStorage } from "electron";
import type Database from "libsql";

export function storeApiKey(db: Database.Database, provider: string, key: string): void {
  if (!safeStorage.isEncryptionAvailable()) {
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)").run(
      `apikey_${provider}`,
      key,
    );
    return;
  }
  const encrypted = safeStorage.encryptString(key);
  const base64 = encrypted.toString("base64");
  db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)").run(
    `apikey_${provider}`,
    `encrypted:${base64}`,
  );
}

export function getApiKey(db: Database.Database, provider: string): string | null {
  const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(`apikey_${provider}`) as
    | { value: string }
    | undefined;
  if (!row) return null;
  const value = row.value;
  if (value.startsWith("encrypted:") && safeStorage.isEncryptionAvailable()) {
    const base64 = value.slice("encrypted:".length);
    const buffer = Buffer.from(base64, "base64");
    return safeStorage.decryptString(buffer);
  }
  return value;
}

export function deleteApiKey(db: Database.Database, provider: string): void {
  db.prepare("DELETE FROM settings WHERE key = ?").run(`apikey_${provider}`);
}

export function listApiKeys(db: Database.Database): Array<{ provider: string; hasKey: boolean }> {
  const rows = db.prepare("SELECT key FROM settings WHERE key LIKE 'apikey_%'").all() as {
    key: string;
  }[];
  return rows.map((r) => ({
    provider: r.key.replace("apikey_", ""),
    hasKey: true,
  }));
}
