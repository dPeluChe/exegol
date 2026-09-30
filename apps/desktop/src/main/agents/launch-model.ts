import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { MODEL_ID_PATTERN, MODEL_LAUNCH } from "@exegol/shared";
import { EXEGOL_DIR } from "../terminal/pty-sidecar-protocol";

interface LaunchConfig {
  args: string[];
  env: Record<string, string>;
}

/** Hand the session's model to its CLI the way MODEL_LAUNCH says: a flag, an env var, or (droid)
 *  a settings file merged for that process only. A CLI with no way, or a bad id, is untouched */
export function applyLaunchModel(
  cliConfig: LaunchConfig,
  cliType: string,
  model: string | null | undefined,
  agentId: string,
  settingsDir = join(EXEGOL_DIR, "model-settings"),
): LaunchConfig {
  const launch = MODEL_LAUNCH[cliType];
  if (!launch || !model || !MODEL_ID_PATTERN.test(model)) return cliConfig;
  if ("flag" in launch) return { ...cliConfig, args: [...cliConfig.args, launch.flag, model] };
  if ("env" in launch) return { ...cliConfig, env: { ...cliConfig.env, [launch.env]: model } };
  mkdirSync(settingsDir, { recursive: true });
  const file = join(settingsDir, `${agentId}.json`);
  writeFileSync(file, JSON.stringify({ model }));
  return { ...cliConfig, args: [...cliConfig.args, "--settings", file] };
}
