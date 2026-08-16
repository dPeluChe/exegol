import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

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
  if (!existsSync(path)) return null;
  try {
    return await readFile(path, "utf-8");
  } catch {
    return null;
  }
}

/** Target lines only: no `.PHONY`, no `%` pattern rules, no `VAR := value`. */
export function parseMakeTargets(content: string): string[] {
  const names: string[] = [];
  for (const line of content.split("\n")) {
    const match = line.match(/^([A-Za-z0-9_][A-Za-z0-9_.-]*)\s*:(?!=)/);
    const name = match?.[1];
    if (!name || names.includes(name)) continue;
    names.push(name);
  }
  return names;
}

/** Recipes start at column 0 and end in `:`; `x := y` is an assignment. */
export function parseJustRecipes(content: string): string[] {
  const names: string[] = [];
  for (const line of content.split("\n")) {
    if (!line || /^\s/.test(line) || line.startsWith("#")) continue;
    const match = line.match(/^([A-Za-z0-9_][A-Za-z0-9_-]*)(?:\s+[^:]*)?:(?!=)/);
    const name = match?.[1];
    if (!name || names.includes(name)) continue;
    names.push(name);
  }
  return names;
}

/** `.exegol/actions.yaml`: `name: command`, same line-based shape as lifecycle.yaml. */
export function parseCustomActions(content: string): Array<{ name: string; command: string }> {
  const actions: Array<{ name: string; command: string }> = [];
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = trimmed.match(/^([A-Za-z0-9_][A-Za-z0-9 _-]*?)\s*:\s*(.+)$/);
    const name = match?.[1]?.trim();
    let command = match?.[2]?.trim();
    if (!name || !command) continue;
    if (
      (command.startsWith('"') && command.endsWith('"')) ||
      (command.startsWith("'") && command.endsWith("'"))
    ) {
      command = command.slice(1, -1);
    }
    actions.push({ name, command });
  }
  return actions;
}

async function detectRunActions(projectPath: string): Promise<DetectedScript[]> {
  const results: DetectedScript[] = [];

  for (const file of ["Makefile", "makefile", "GNUmakefile"]) {
    const content = await readIfExists(join(projectPath, file));
    if (!content) continue;
    for (const name of rankTargets(parseMakeTargets(content))) {
      results.push({ name, command: `make ${name}`, source: file });
    }
    break; // one makefile per project — the first that exists is the real one
  }

  for (const file of ["justfile", "Justfile", ".justfile"]) {
    const content = await readIfExists(join(projectPath, file));
    if (!content) continue;
    for (const name of rankTargets(parseJustRecipes(content))) {
      results.push({ name, command: `just ${name}`, source: file });
    }
    break;
  }

  // User-defined actions come LAST but are never truncated: someone wrote them
  // down on purpose, which is a stronger signal than any heuristic above.
  const custom = await readIfExists(join(projectPath, ".exegol", "actions.yaml"));
  for (const action of custom ? parseCustomActions(custom) : []) {
    results.push({ ...action, source: ".exegol/actions.yaml" });
  }

  return results;
}

export async function detectProjectScripts(projectPath: string): Promise<DetectedScript[]> {
  const [node, python, other, actions] = await Promise.all([
    detectNodeScripts(projectPath),
    detectPythonScripts(projectPath),
    detectOtherScripts(projectPath),
    detectRunActions(projectPath),
  ]);

  return [...node, ...python, ...other, ...actions];
}
