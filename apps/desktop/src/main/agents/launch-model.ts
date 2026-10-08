import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  appliedModelRoles,
  MODEL_ID_PATTERN,
  MODEL_LAUNCH,
  MODEL_ROLES,
  type ModelLaunch,
} from "@exegol/shared";
import { z } from "zod";
import { parseJson } from "../lib/parse-json";
import { EXEGOL_DIR } from "../terminal/pty-sidecar-protocol";

interface LaunchConfig {
  args: string[];
  env: Record<string, string>;
}

type JsonObject = Record<string, unknown>;

function setPath(target: JsonObject, path: string[], value: string): void {
  const last = path[path.length - 1];
  if (!last) return;
  let node = target;
  for (const key of path.slice(0, -1)) {
    const next = node[key];
    if (!next || typeof next !== "object") node[key] = {};
    node = node[key] as JsonObject;
  }
  node[last] = value;
}

const jsonObjectSchema = z.record(z.string(), z.unknown());

/** Hand the session's model and role models (advisor, subagents...) to its CLI the way
 *  MODEL_LAUNCH and MODEL_ROLES say. A CLI with no way, or a bad id, is untouched */
export function applyLaunchModel(
  cliConfig: LaunchConfig,
  cliType: string,
  model: string | null | undefined,
  agentId: string,
  roles: Record<string, string> | null = null,
  settingsDir = join(EXEGOL_DIR, "model-settings"),
): LaunchConfig {
  const picks: [ModelLaunch, string][] = [];
  const main = MODEL_LAUNCH[cliType];
  if (main && model && MODEL_ID_PATTERN.test(model)) picks.push([main, model]);
  // A role this CLI lacks, or a pairing Claude Code exits on (Fable or Haiku advisor), is left out
  const applied = appliedModelRoles(cliType, roles, model ?? "");
  for (const role of MODEL_ROLES[cliType] ?? []) {
    const value = applied[role.id];
    if (value) picks.push([role.launch, value]);
  }
  if (picks.length === 0) return cliConfig;

  const args = [...cliConfig.args];
  const env = { ...cliConfig.env };
  const jsonEnv: Record<string, JsonObject> = {};
  let settings: JsonObject | null = null;
  for (const [launch, value] of picks) {
    if ("flag" in launch) {
      for (const extra of launch.with ?? []) if (!args.includes(extra)) args.push(extra);
      args.push(launch.flag, launch.key ? `${launch.key}=${value}` : value);
    } else if ("env" in launch) {
      env[launch.env] = value;
    } else if ("jsonEnv" in launch) {
      const config =
        jsonEnv[launch.jsonEnv] ??
        parseJson(env[launch.jsonEnv] ?? process.env[launch.jsonEnv] ?? "", jsonObjectSchema) ??
        {};
      jsonEnv[launch.jsonEnv] = config;
      setPath(config, launch.path, value);
    } else {
      settings ??= {};
      setPath(settings, launch.settingsFile, value);
    }
  }
  for (const [name, config] of Object.entries(jsonEnv)) env[name] = JSON.stringify(config);
  if (settings) {
    mkdirSync(settingsDir, { recursive: true });
    const file = join(settingsDir, `${agentId}.json`);
    writeFileSync(file, JSON.stringify(settings));
    args.push("--settings", file);
  }
  return { ...cliConfig, args, env };
}
