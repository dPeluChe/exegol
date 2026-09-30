import { execFile } from "node:child_process";
import { MODEL_ID_PATTERN } from "@exegol/shared";
import { logger } from "../lib/logger";
import { getProviderRegistry } from "./registry";
import { _getFullPath, resolveCommand } from "./spawn-env";

type Parse = (stdout: string) => string[];

const firstColumn: Parse = (out) =>
  out
    .split("\n")
    .map((l) => l.trim().split(/\s+/)[0] ?? "")
    .filter(Boolean);

/** CLIs that list the models this account can use, and how to read each one's output */
const LIST_COMMANDS: Partial<Record<string, { args: string[]; parse: Parse }>> = {
  codex: {
    args: ["debug", "models"],
    parse: (out) =>
      (JSON.parse(out) as { models?: { slug?: string }[] }).models?.map((m) => m.slug ?? "") ?? [],
  },
  // "id<TAB>name", after a "Fetching…" line
  agy: {
    args: ["models"],
    parse: (out) =>
      out
        .split("\n")
        .filter((l) => l.includes("\t"))
        .map((l) => l.split("\t")[0] ?? ""),
  },
  // Families with indented "  id   Name  [price]" rows and "  aliases: …" lines
  devin: {
    args: ["models", "list"],
    parse: (out) => [...out.matchAll(/^ {2}(?!aliases:)(\S+)\s{2,}/gm)].map((m) => m[1] ?? ""),
  },
  opencode: { args: ["models"], parse: firstColumn },
  kilocode: { args: ["models"], parse: firstColumn },
};

const TTL_MS = 60 * 60 * 1000;
const cache = new Map<string, { at: number; models: string[] }>();

function run(command: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) =>
    execFile(
      command,
      args,
      {
        env: { ...process.env, PATH: _getFullPath() },
        timeout: 15_000,
        maxBuffer: 4 * 1024 * 1024,
      },
      (err, stdout) => (err ? reject(err) : resolve(stdout)),
    ),
  );
}

/** The models a CLI offers this account, from its own list command (cached an hour). Empty when
 *  it has none, is not installed, or fails: the launcher still takes a typed id */
export async function listCliModels(cliType: string): Promise<string[]> {
  const list = LIST_COMMANDS[cliType];
  const provider = getProviderRegistry().get(cliType);
  if (!list || !provider) return [];
  const hit = cache.get(cliType);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.models;
  let models: string[] = [];
  try {
    const out = await run(resolveCommand(provider.command), list.args);
    models = [...new Set(list.parse(out))].filter((m) => MODEL_ID_PATTERN.test(m));
  } catch (err) {
    logger.info(
      `[Models] ${cliType} list unavailable: ${err instanceof Error ? err.message : err}`,
    );
  }
  cache.set(cliType, { at: Date.now(), models });
  return models;
}

export const _parsers = { LIST_COMMANDS };
