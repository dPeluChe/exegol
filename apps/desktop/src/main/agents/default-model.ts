import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { MODEL_ID_PATTERN } from "@exegol/shared";

/** The model a CLI uses when launched without one, and where that setting lives */
export interface DefaultModel {
  model: string;
  source: string;
}

const valid = (m: unknown): m is string =>
  typeof m === "string" && m.trim() !== "" && MODEL_ID_PATTERN.test(m.trim());

function jsonModel(text: string | null, pick: (o: Record<string, unknown>) => unknown) {
  if (!text) return null;
  try {
    const value = pick(JSON.parse(text) as Record<string, unknown>);
    return valid(value) ? value.trim() : null;
  } catch {
    return null;
  }
}

/** Claude Code: ANTHROPIC_MODEL wins over settings.json `model` (its own precedence) */
export function claudeDefaultModel(
  settingsJson: string | null,
  env: Record<string, string | undefined>,
): DefaultModel | null {
  if (valid(env.ANTHROPIC_MODEL))
    return { model: env.ANTHROPIC_MODEL.trim(), source: "ANTHROPIC_MODEL" };
  const model = jsonModel(settingsJson, (o) => o.model);
  return model ? { model, source: "~/.claude/settings.json" } : null;
}

/** Codex: the top-level `model = "..."` of config.toml (before any [table]) */
export function codexDefaultModel(toml: string | null): DefaultModel | null {
  if (!toml) return null;
  for (const raw of toml.split("\n")) {
    const line = raw.trim();
    if (line.startsWith("[")) break;
    const m = /^model\s*=\s*["']([^"']+)["']/.exec(line);
    if (m && valid(m[1])) return { model: m[1], source: "~/.codex/config.toml" };
  }
  return null;
}

/** Gemini: settings.json `model.name` (or a plain `model` string) */
export function geminiDefaultModel(settingsJson: string | null): DefaultModel | null {
  const model = jsonModel(settingsJson, (o) =>
    typeof o.model === "object" && o.model ? (o.model as Record<string, unknown>).name : o.model,
  );
  return model ? { model, source: "~/.gemini/settings.json" } : null;
}

const read = (path: string) => readFile(path, "utf8").catch(() => null);

async function detect(cliType: string): Promise<DefaultModel | null> {
  const home = homedir();
  if (cliType === "claude-code") {
    return claudeDefaultModel(await read(join(home, ".claude", "settings.json")), process.env);
  }
  if (cliType === "codex") {
    const dir = process.env.CODEX_HOME || join(home, ".codex");
    return codexDefaultModel(await read(join(dir, "config.toml")));
  }
  if (cliType === "gemini")
    return geminiDefaultModel(await read(join(home, ".gemini", "settings.json")));
  return null;
}

const TTL_MS = 30_000;
const cache = new Map<string, { at: number; value: Promise<DefaultModel | null> }>();

/** Cached 30 s: the launcher asks on every form, the user may edit the file in between */
export function cliDefaultModel(cliType: string): Promise<DefaultModel | null> {
  const hit = cache.get(cliType);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;
  const value = detect(cliType).catch(() => null);
  cache.set(cliType, { at: Date.now(), value });
  return value;
}
