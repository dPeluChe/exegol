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

function normalize(path: string): string {
  const trimmed = path.replace(/\/+$/, "");
  return trimmed === "" ? "/" : trimmed;
}

export function matchProjectByPath<T extends ProjectLike>(projects: T[], path: string): T | null {
  const target = normalize(path);
  const exact = projects.find((p) => normalize(p.path) === target);
  if (exact) return exact;

  let best: T | null = null;
  for (const project of projects) {
    const root = normalize(project.path);
    if (!target.startsWith(`${root}/`)) continue;
    if (!best || root.length > normalize(best.path).length) best = project;
  }
  return best;
}
