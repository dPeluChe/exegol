import { stat } from "node:fs/promises";
import { join } from "node:path";
import type { ProjectShape } from "@exegol/shared";
import { findRepoFolders } from "../integrations/github/repos";
import { mapWithConcurrency } from "../lib/concurrency";
import { AsyncLruCache } from "../lib/lru-cache";

const SHAPE_TTL_MS = 10 * 60_000;
const MAX_NAMES = 40;
const CONCURRENCY = 4;

async function shapeOf(path: string): Promise<ProjectShape> {
  if (await stat(join(path, ".git")).then(Boolean, () => false)) {
    return { kind: "repo", repoCount: 1, repos: [] };
  }
  const repos = await findRepoFolders(path);
  return {
    kind: repos.length > 0 ? "workspace" : "folder",
    repoCount: repos.length,
    repos: repos.slice(0, MAX_NAMES),
  };
}

const cache = new AsyncLruCache<string, ProjectShape>(256, SHAPE_TTL_MS);

/** A repo, a workspace of repos (the root is not one) or a plain folder, per project id */
export async function projectShapes(
  projects: { id: string; path: string }[],
): Promise<Record<string, ProjectShape>> {
  const out: Record<string, ProjectShape> = {};
  await mapWithConcurrency(projects, CONCURRENCY, async (p) => {
    out[p.id] = await cache.getOrCompute(p.path, () => shapeOf(p.path));
  });
  return out;
}
