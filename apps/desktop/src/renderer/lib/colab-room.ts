import type { ColabMember, Project } from "@exegol/shared";

/** The projects a colab can still take, by name, narrowed by what was typed (name or path).
 *  One that is in as a whole project is left out; a workspace with only parts in stays */
export function joinable<P extends Pick<Project, "id" | "name"> & { path?: string }>(
  projects: P[],
  members: Pick<ColabMember, "projectId" | "repo">[],
  query: string,
): P[] {
  const whole = new Set(members.filter((m) => !m.repo).map((m) => m.projectId));
  const words = query.trim().toLowerCase();
  return projects
    .filter(
      (p) =>
        !whole.has(p.id) && (!words || `${p.name} ${p.path ?? ""}`.toLowerCase().includes(words)),
    )
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
}

export const memberKey = (m: Pick<ColabMember, "projectId" | "repo">) => `${m.projectId}/${m.repo}`;

export const memberLabel = (m: Pick<ColabMember, "projectName" | "repo">) =>
  m.repo ? `${m.projectName} / ${m.repo}` : m.projectName;
