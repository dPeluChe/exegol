import { safeStorage } from "electron";
import type Database from "libsql";
import { logger } from "../lib/logger";

// Session-level cache — decryptString is crypto-expensive and keys don't
// change at runtime except through the Settings UI (store/delete clear it).
const apiKeyCache = new Map<string, string | null>();

export function storeApiKey(db: Database.Database, provider: string, key: string): void {
  apiKeyCache.delete(provider);
  if (!safeStorage.isEncryptionAvailable()) {
    logger.warn(
      `[Keystore] OS encryption unavailable — storing '${provider}' API key in PLAINTEXT (surfaced in Settings > API Keys and Doctor)`,
    );
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
  if (apiKeyCache.has(provider)) return apiKeyCache.get(provider) ?? null;
  const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(`apikey_${provider}`) as
    | { value: string }
    | undefined;
  if (!row) {
    apiKeyCache.set(provider, null);
    return null;
  }
  const value = row.value;
  // A Linux keyring can be gone on the next login: ciphertext must never reach a provider as a key
  const result = value.startsWith("encrypted:") ? decrypted(value, provider) : value;
  apiKeyCache.set(provider, result);
  return result;
}

function decrypted(value: string, provider: string): string | null {
  try {
    if (safeStorage.isEncryptionAvailable()) {
      return safeStorage.decryptString(Buffer.from(value.slice("encrypted:".length), "base64"));
    }
  } catch {
    /* logged below */
  }
  logger.warn(`[Keystore] Cannot read the ${provider} key: the system keyring is unavailable`);
  return null;
}

export function deleteApiKey(db: Database.Database, provider: string): void {
  apiKeyCache.delete(provider);
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
