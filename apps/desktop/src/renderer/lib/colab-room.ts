import type { ColabMember, Project } from "@exegol/shared";

export interface Joinable<P> {
  project: P;
  /** Already a member as a whole project */
  joined: boolean;
}

/** The projects a colab can take, by name, narrowed by what was typed */
export function joinable<P extends Pick<Project, "id" | "name">>(
  projects: P[],
  members: Pick<ColabMember, "projectId" | "repo">[],
  query: string,
): Joinable<P>[] {
  const whole = new Set(members.filter((m) => !m.repo).map((m) => m.projectId));
  const words = query.trim().toLowerCase();
  return projects
    .filter((p) => !words || p.name.toLowerCase().includes(words))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }))
    .map((project) => ({ project, joined: whole.has(project.id) }));
}

export const memberKey = (m: Pick<ColabMember, "projectId" | "repo">) => `${m.projectId}/${m.repo}`;
