import { join } from "node:path";
import type { Project } from "@exegol/shared";
import type Database from "libsql";
import { repoFoldersOf } from "../integrations/github/repos";
import { projectShapes } from "../system/project-shape";
import { liveSessionRepos } from "../system/session-repos";

export interface FleetRepos {
  /** Workspaces only (the root is no repo): the repos inside, as folders of the project */
  ofProject: Map<string, string[]>;
  /** The one each live session works in, by session id */
  ofSession: Map<string, string>;
}

/** What the Projects view calls a workspace, by folder name and never a path. Read from disk
 *  (cached 30 min); sessions are placed only in the projects `live` names */
export async function fleetRepos(
  db: Database.Database,
  projects: Pick<Project, "id" | "path">[],
  live: ReadonlySet<string>,
): Promise<FleetRepos> {
  const out: FleetRepos = { ofProject: new Map(), ofSession: new Map() };
  const shapes = await projectShapes(projects);
  for (const p of projects) {
    const shape = shapes[p.id];
    if (shape?.kind !== "workspace") continue;
    out.ofProject.set(p.id, shape.repos);
    if (!live.has(p.id)) continue;
    const folders = await repoFoldersOf(p.path);
    const repos = folders.map((folder) => ({ folder, path: join(p.path, folder) }));
    for (const [id, folder] of liveSessionRepos(db, p.id, repos)) out.ofSession.set(id, folder);
  }
  return out;
}
