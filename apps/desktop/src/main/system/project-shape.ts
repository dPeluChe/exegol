import { stat } from "node:fs/promises";
import { join } from "node:path";
import type { ProjectShape } from "@exegol/shared";
import { repoFoldersOf } from "../integrations/github/repos";
import { mapWithConcurrency } from "../lib/concurrency";

const MAX_NAMES = 40;
const CONCURRENCY = 4;

async function shapeOf(path: string): Promise<ProjectShape> {
  if (await stat(join(path, ".git")).then(Boolean, () => false)) {
    return { kind: "repo", repoCount: 1, repos: [] };
  }
  const repos = await repoFoldersOf(path);
  return {
    kind: repos.length > 0 ? "workspace" : "folder",
    repoCount: repos.length,
    repos: repos.slice(0, MAX_NAMES),
  };
}

/** A repo, a workspace of repos (the root is not one) or a plain folder, per project id */
export async function projectShapes(
  projects: { id: string; path: string }[],
): Promise<Record<string, ProjectShape>> {
  const out: Record<string, ProjectShape> = {};
  await mapWithConcurrency(projects, CONCURRENCY, async (p) => {
    out[p.id] = await shapeOf(p.path);
  });
  return out;
}
