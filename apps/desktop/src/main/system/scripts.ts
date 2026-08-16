import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { parseFlatConfig } from "../lib/flat-config";
import { logger } from "../lib/logger";
import { inspectCommand } from "../security/command-guard";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface DetectedScript {
  name: string;
  command: string;
  source: string;
  framework?: string;
}

// ─── Framework Detection ────────────────────────────────────────────────────

const FRAMEWORK_DEPS: [string, string][] = [
  ["next", "next"],
  ["@vitejs/plugin-react", "vite"],
  ["vite", "vite"],
  ["react-scripts", "cra"],
  ["nuxt", "nuxt"],
  ["@remix-run/dev", "remix"],
  ["astro", "astro"],
  ["svelte", "svelte"],
  ["@angular/cli", "angular"],
];

const KNOWN_SCRIPTS = ["dev", "start", "serve", "develop", "watch", "preview"];

function detectFramework(deps: Record<string, string>): string | undefined {
  for (const [pkg, fw] of FRAMEWORK_DEPS) {
    if (deps[pkg]) return fw;
  }
  return undefined;
}

// ─── Node Detector ──────────────────────────────────────────────────────────

async function detectNodeScripts(projectPath: string): Promise<DetectedScript[]> {
  const pkgPath = join(projectPath, "package.json");
  if (!existsSync(pkgPath)) return [];

  try {
    const raw = await readFile(pkgPath, "utf-8");
    const pkg = JSON.parse(raw) as {
      scripts?: Record<string, string>;
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };

    if (!pkg.scripts) return [];

    const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };
    const framework = detectFramework(allDeps);

    // Detect package manager
    const pm = existsSync(join(projectPath, "bun.lockb"))
      ? "bun"
      : existsSync(join(projectPath, "pnpm-lock.yaml"))
        ? "pnpm"
        : existsSync(join(projectPath, "yarn.lock"))
          ? "yarn"
          : "npm";

    const results: DetectedScript[] = [];

    for (const name of KNOWN_SCRIPTS) {
      if (pkg.scripts[name]) {
        results.push({
          name,
          command: `${pm} run ${name}`,
          source: "package.json",
          framework,
        });
      }
    }

    // Also detect "build" separately (useful but not a dev server)
    if (pkg.scripts.build) {
      results.push({
        name: "build",
        command: `${pm} run build`,
        source: "package.json",
        framework,
      });
    }

    return results;
  } catch {
    return [];
  }
}

// ─── Python Detector ────────────────────────────────────────────────────────

async function detectPythonScripts(projectPath: string): Promise<DetectedScript[]> {
  const results: DetectedScript[] = [];

  // Django
  if (existsSync(join(projectPath, "manage.py"))) {
    results.push({
      name: "runserver",
      command: "python manage.py runserver",
      source: "manage.py",
      framework: "django",
    });
  }

  // Check requirements.txt and pyproject.toml for framework hints
  let depsContent = "";
  for (const file of ["requirements.txt", "pyproject.toml"]) {
    const p = join(projectPath, file);
    if (existsSync(p)) {
      try {
        depsContent += await readFile(p, "utf-8");
      } catch {
        /* skip */
      }
    }
  }

  if (depsContent) {
    if (/\bfastapi\b/i.test(depsContent)) {
      // Check for main.py or app.py
      const entryFile = existsSync(join(projectPath, "main.py"))
        ? "main:app"
        : existsSync(join(projectPath, "app.py"))
          ? "app:app"
          : "main:app";
      results.push({
        name: "uvicorn",
        command: `uvicorn ${entryFile} --reload`,
        source: "requirements.txt",
        framework: "fastapi",
      });
    }

    if (/\bflask\b/i.test(depsContent) && !results.some((r) => r.framework === "fastapi")) {
      results.push({
        name: "flask run",
        command: "flask run --reload",
        source: "requirements.txt",
        framework: "flask",
      });
    }
  }

  return results;
}

// ─── Cargo / Go Detector ────────────────────────────────────────────────────

async function detectOtherScripts(projectPath: string): Promise<DetectedScript[]> {
  const results: DetectedScript[] = [];

  if (existsSync(join(projectPath, "Cargo.toml"))) {
    results.push({
      name: "run",
      command: "cargo run",
      source: "Cargo.toml",
      framework: "rust",
    });
  }

  if (existsSync(join(projectPath, "go.mod"))) {
    results.push({
      name: "run",
      command: "go run .",
      source: "go.mod",
      framework: "go",
    });
  }

  return results;
}

// ─── Main Export ────────────────────────────────────────────────────────────

/**
 * T179 — Makefile / justfile / user-defined actions.
 *
 * A Makefile can carry sixty targets, and the launcher renders every script it
 * is given, so detection ranks the ones a person actually runs and stops. The
 * order below IS the ranking; anything unlisted keeps file order behind it.
 */
const COMMON_TARGETS = [
  "dev",
  "run",
  "start",
  "serve",
  "build",
  "test",
  "lint",
  "fmt",
  "format",
  "check",
  "install",
  "setup",
  "clean",
];
const MAX_TARGETS_PER_FILE = 12;

function rankTargets(names: string[]): string[] {
  const known = COMMON_TARGETS.filter((t) => names.includes(t));
  const rest = names.filter((n) => !COMMON_TARGETS.includes(n));
  return [...known, ...rest].slice(0, MAX_TARGETS_PER_FILE);
}

async function readIfExists(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf-8");
  } catch {
    return null;
  }
}

/** Names declared at column 0 and followed by `:`. Everything this REJECTS is
 *  the point: `.PHONY`, `%` pattern rules, `VAR := value` and indented lines
 *  all look like targets, and a false positive is a button that runs nothing. */
function parseTargets(content: string, pattern: RegExp): string[] {
  const names = new Set<string>();
  for (const line of content.split("\n")) {
    if (line.startsWith("#")) continue;
    const name = line.match(pattern)?.[1];
    if (name) names.add(name);
  }
  return [...names];
}

export const parseMakeTargets = (content: string): string[] =>
  parseTargets(content, /^([A-Za-z0-9_][A-Za-z0-9_.-]*)\s*:(?!=)/);

export const parseJustRecipes = (content: string): string[] =>
  parseTargets(content, /^([A-Za-z0-9_][A-Za-z0-9_-]*)(?:\s+[^:]*)?:(?!=)/);

/** `.exegol/actions.yaml`: `name: command`, same shape as `lifecycle.yaml`.
 *
 *  These are commands read out of a repo — the same trust level as a lifecycle
 *  hook — so they pass the same safety gate. A cloned repo must not be able to
 *  put `rm -rf ~` behind a chip labelled "dev". */
export function parseCustomActions(content: string): Array<{ name: string; command: string }> {
  const actions: Array<{ name: string; command: string }> = [];
  for (const [name, command] of parseFlatConfig(content)) {
    const verdict = inspectCommand(command);
    if (!verdict.ok) {
      logger.warn(`[Scripts] Action "${name}" refused by safety guard (${verdict.reason})`);
      continue;
    }
    actions.push({ name, command });
  }
  return actions;
}

/** One row per runner: which filenames to try, how to read names out, and how
 *  a name becomes a command. The first filename that exists wins — a project
 *  has one Makefile, and the alternatives are spellings, not extra files. */
const RUNNERS: Array<{
  files: string[];
  parse: (content: string) => string[];
  command: (name: string) => string;
}> = [
  {
    files: ["Makefile", "makefile", "GNUmakefile"],
    parse: parseMakeTargets,
    command: (name) => `make ${name}`,
  },
  {
    files: ["justfile", "Justfile", ".justfile"],
    parse: parseJustRecipes,
    command: (name) => `just ${name}`,
  },
];

async function detectRunActions(projectPath: string): Promise<DetectedScript[]> {
  const [runnerResults, customContent] = await Promise.all([
    Promise.all(
      RUNNERS.map(async (runner) => {
        for (const file of runner.files) {
          const content = await readIfExists(join(projectPath, file));
          if (content === null) continue;
          return rankTargets(runner.parse(content)).map((name) => ({
            name,
            command: runner.command(name),
            source: file,
          }));
        }
        return [];
      }),
    ),
    readIfExists(join(projectPath, ".exegol", "actions.yaml")),
  ]);

  // User-defined actions come LAST but are never truncated: someone wrote them
  // down on purpose, which is a stronger signal than any heuristic above.
  const custom = customContent
    ? parseCustomActions(customContent).map((a) => ({ ...a, source: ".exegol/actions.yaml" }))
    : [];

  return [...runnerResults.flat(), ...custom];
}

// Detection is ~20 stats and up to 6 reads on the main thread, and an empty
// pane is the DEFAULT state of a new pane — so every pane mount past the
// renderer's 60s staleTime would re-run the storm. TTL rather than
// session-scoped (lifecycle.yaml's model): adding a script to package.json and
// waiting a minute is a reasonable ask; restarting the app is not.
const SCRIPTS_TTL_MS = 60_000;
const scriptsCache = new Map<string, { at: number; scripts: DetectedScript[] }>();

export async function detectProjectScripts(projectPath: string): Promise<DetectedScript[]> {
  const cached = scriptsCache.get(projectPath);
  if (cached && Date.now() - cached.at < SCRIPTS_TTL_MS) return cached.scripts;

  const [node, python, other, actions] = await Promise.all([
    detectNodeScripts(projectPath),
    detectPythonScripts(projectPath),
    detectOtherScripts(projectPath),
    detectRunActions(projectPath),
  ]);

  const scripts = [...node, ...python, ...other, ...actions];
  scriptsCache.set(projectPath, { at: Date.now(), scripts });
  return scripts;
}
