import { isUnderPath, samePath } from "@exegol/shared";

/**
 * T155.6 — match an `exegol .` deep-link path against registered projects.
 *
 * Exact match wins; otherwise the deepest project that is an ancestor of the
 * path (so `exegol .` from a subdirectory still lands on the right project).
 */

interface ProjectLike {
  id: string;
  path: string;
}

export function matchProjectByPath<T extends ProjectLike>(projects: T[], path: string): T | null {
  const exact = projects.find((p) => samePath(p.path, path));
  if (exact) return exact;

  let best: T | null = null;
  for (const project of projects) {
    if (!isUnderPath(path, project.path)) continue;
    if (!best || project.path.length > best.path.length) best = project;
  }
  return best;
}
