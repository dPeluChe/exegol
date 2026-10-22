/**
 * Project Knowledge Node (T140) — DIGEST.md: auto-generated structural summary.
 * `trs ingest` when trs is on PATH, else a small internal summarizer (top-level layout +
 * package.json deps + file mix). Derivable + high-churn — gitignored by default (see paths.ts).
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { extname, join } from "node:path";
import { findOnPath } from "../agents/spawn-env";
import { childEnv } from "../lib/child-env";
import { execFileAsync } from "../lib/exec-file";
import { logger } from "../lib/logger";
import { launchFor } from "../lib/win-launch";

const IGNORED_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  "out",
  ".turbo",
  ".next",
  "target",
  "coverage",
]);

/** 32k tokens fits a prompt. A trs without `ingest` fails and falls back */
const TRS_INGEST_ARGS = ["ingest", "--print", "--budget", "32k"];

let missingLogged = false;

async function generateDigestViaTrs(projectPath: string): Promise<string | null> {
  const trs = findOnPath("trs");
  if (!trs) {
    if (!missingLogged) logger.info("[Knowledge] trs not on PATH, using the internal digest");
    missingLogged = true;
    return null;
  }
  // npm installs trs.cmd on Windows, which execFile cannot start alone
  const { command, args, verbatim } = launchFor(
    [trs, ...TRS_INGEST_ARGS, projectPath],
    process.platform,
    process.env.ComSpec,
  );
  try {
    // stderr carries notices (not a git repository, size), never the digest
    const { stdout } = await execFileAsync(command, args, {
      windowsVerbatimArguments: verbatim,
      windowsHide: true,
      env: childEnv(),
      timeout: 30_000,
      maxBuffer: 2 * 1024 * 1024,
    });
    return stdout.trim() || null;
  } catch (err) {
    const code = (err as { code?: unknown }).code;
    logger.warn(
      `[Knowledge] trs ingest failed (${String(code ?? "error")}), using the internal digest`,
    );
    return null;
  }
}

interface DirEntrySummary {
  name: string;
  fileCount: number;
  topExtensions: string[];
}

function summarizeTopLevel(projectPath: string): DirEntrySummary[] {
  const entries = readdirSync(projectPath, { withFileTypes: true }).filter(
    (e) => e.isDirectory() && !IGNORED_DIRS.has(e.name) && !e.name.startsWith("."),
  );

  return entries.map((entry) => {
    const extCounts = new Map<string, number>();
    let fileCount = 0;
    const walk = (dir: string, depth: number) => {
      if (depth > 3) return;
      let children: import("node:fs").Dirent[];
      try {
        children = readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const child of children) {
        if (child.isDirectory()) {
          if (!IGNORED_DIRS.has(child.name) && !child.name.startsWith(".")) {
            walk(join(dir, child.name), depth + 1);
          }
        } else {
          fileCount++;
          const ext = extname(child.name) || "(none)";
          extCounts.set(ext, (extCounts.get(ext) ?? 0) + 1);
        }
      }
    };
    walk(join(projectPath, entry.name), 0);

    const topExtensions = [...extCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([ext, count]) => `${ext} (${count})`);

    return { name: entry.name, fileCount, topExtensions };
  });
}

function summarizePackageJson(projectPath: string): string | null {
  const pkgPath = join(projectPath, "package.json");
  if (!existsSync(pkgPath)) return null;
  try {
    const pkg = JSON.parse(readFileSync(pkgPath, "utf-8")) as {
      name?: string;
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const deps = Object.keys(pkg.dependencies ?? {});
    const devDeps = Object.keys(pkg.devDependencies ?? {});
    const lines = [`**Package**: ${pkg.name ?? "(unnamed)"}`];
    if (deps.length > 0)
      lines.push(`**Dependencies** (${deps.length}): ${deps.slice(0, 20).join(", ")}`);
    if (devDeps.length > 0)
      lines.push(`**Dev dependencies** (${devDeps.length}): ${devDeps.slice(0, 20).join(", ")}`);
    return lines.join("\n\n");
  } catch (err) {
    logger.warn("[Knowledge] Failed to parse package.json for digest:", err);
    return null;
  }
}

function generateInternalDigest(projectPath: string): string {
  const dirs = summarizeTopLevel(projectPath).filter((d) => d.fileCount > 0);
  const pkgSummary = summarizePackageJson(projectPath);

  const dirLines = dirs
    .sort((a, b) => b.fileCount - a.fileCount)
    .map(
      (d) => `- \`${d.name}/\` — ${d.fileCount} files (${d.topExtensions.join(", ") || "mixed"})`,
    );

  const parts = [
    "# Codebase Digest\n\n_Auto-generated. Do not edit by hand — see PROJECT.md for the human-authored brief._",
  ];
  if (pkgSummary) parts.push(pkgSummary);
  if (dirLines.length > 0) parts.push(`## Top-level layout\n\n${dirLines.join("\n")}`);

  return `${parts.join("\n\n")}\n`;
}

/** Generate the digest: `trs ingest` if available, else the internal summarizer. */
export async function computeDigest(projectPath: string): Promise<string> {
  return (await generateDigestViaTrs(projectPath)) ?? generateInternalDigest(projectPath);
}
