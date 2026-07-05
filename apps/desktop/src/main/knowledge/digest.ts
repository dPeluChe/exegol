/**
 * Project Knowledge Node (T140) — DIGEST.md: auto-generated structural summary.
 * Tries an external `trs digest` binary first (if installed), falls back to a
 * small internal summarizer (top-level layout + package.json deps + file mix).
 * Derivable + high-churn — gitignored by default (see paths.ts).
 */

import { execSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join } from "node:path";
import { logger } from "../lib/logger";

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

function isBinAvailable(bin: string): boolean {
  try {
    execSync(`command -v ${bin}`, { stdio: "ignore", timeout: 3_000 });
    return true;
  } catch {
    return false;
  }
}

/**
 * Run `trs digest <path>` if a `trs` binary is on PATH. No widely-available
 * `trs` tool ships a `digest` subcommand today, so this is expected to miss
 * and fall through to the internal summarizer on most machines — that's by
 * design, not a bug: any failure here is caught and logged, never fatal.
 */
function generateDigestViaBinary(projectPath: string): string | null {
  if (!isBinAvailable("trs")) return null;
  try {
    return execSync(`trs digest ${JSON.stringify(projectPath)}`, {
      timeout: 30_000,
      maxBuffer: 2 * 1024 * 1024,
    })
      .toString("utf-8")
      .trim();
  } catch (err) {
    logger.warn("[Knowledge] `trs digest` failed, falling back to internal summarizer:", err);
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
    if (deps.length > 0) lines.push(`**Dependencies** (${deps.length}): ${deps.slice(0, 20).join(", ")}`);
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
    .map((d) => `- \`${d.name}/\` — ${d.fileCount} files (${d.topExtensions.join(", ") || "mixed"})`);

  const parts = [
    "# Codebase Digest\n\n_Auto-generated. Do not edit by hand — see PROJECT.md for the human-authored brief._",
  ];
  if (pkgSummary) parts.push(pkgSummary);
  if (dirLines.length > 0) parts.push(`## Top-level layout\n\n${dirLines.join("\n")}`);

  return `${parts.join("\n\n")}\n`;
}

/** Generate the digest: external `trs digest` binary if available, else the internal summarizer. */
export function computeDigest(projectPath: string): string {
  return generateDigestViaBinary(projectPath) ?? generateInternalDigest(projectPath);
}
