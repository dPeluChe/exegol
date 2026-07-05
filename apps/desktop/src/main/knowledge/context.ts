/**
 * Project Knowledge Node (T140) — spawn/pipeline injection.
 * Same progressive-disclosure mechanism as T127 skills: a short pointer is
 * always injected (~40 tokens), full files are read on demand by the CLI.
 */

import { existsSync } from "node:fs";
import { getDigestPath, getMemoryBridgePath, getProjectBriefPath } from "./paths";

const KNOWLEDGE_FILES: Array<{ path: (projectPath: string) => string; label: string }> = [
  { path: getProjectBriefPath, label: "project brief — intent, decisions, roadmap" },
  { path: getDigestPath, label: "auto-generated codebase structure digest" },
  { path: getMemoryBridgePath, label: "distilled team facts (bridge from Exegol's memory store)" },
];

/** Build the progressive-disclosure pointer block for whichever knowledge files exist. */
export function buildKnowledgeContext(projectPath: string): string {
  const present = KNOWLEDGE_FILES.filter((f) => existsSync(f.path(projectPath)));
  if (present.length === 0) return "";

  const pointers = present
    .map((f) => `- \`${f.path(projectPath)}\`: ${f.label} — read when relevant to the task.`)
    .join("\n");

  return `# Project Knowledge\n\nUse your read tool to load these files when relevant:\n\n${pointers}\n`;
}
