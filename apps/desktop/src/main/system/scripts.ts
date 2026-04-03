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

export async function detectProjectScripts(projectPath: string): Promise<DetectedScript[]> {
  const [node, python, other] = await Promise.all([
    detectNodeScripts(projectPath),
    detectPythonScripts(projectPath),
    detectOtherScripts(projectPath),
  ]);

  return [...node, ...python, ...other];
}
