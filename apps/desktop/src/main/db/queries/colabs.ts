import type { Colab, ColabMember } from "@exegol/shared";
import type Database from "libsql";
import { nanoid } from "./helpers";

interface ColabRow {
  id: string;
  name: string;
  purpose: string;
  created_at: number;
}

interface MemberRow {
  colab_id: string;
  project_id: string;
  project_name: string;
  repo: string;
  role: string;
  main: number;
}

const toMember = (r: MemberRow): ColabMember => ({
  projectId: r.project_id,
  projectName: r.project_name,
  repo: r.repo,
  role: r.role,
  main: r.main === 1,
});

const OF_PROJECT = "id IN (SELECT colab_id FROM colab_members WHERE project_id = @projectId)";

/** Every colab, or with a project only the ones it is in */
export function listColabs(db: Database.Database, projectId: string | null = null): Colab[] {
  const only = projectId ? `WHERE ${OF_PROJECT}` : "";
  const colabs = db
    .prepare(`SELECT * FROM colabs ${only} ORDER BY name`)
    .all({ projectId }) as ColabRow[];
  const members = db
    .prepare(
      `SELECT m.*, p.name AS project_name FROM colab_members m JOIN projects p ON p.id = m.project_id
       ${projectId ? `WHERE m.colab_${OF_PROJECT}` : ""} ORDER BY m.main DESC, p.name, m.repo`,
    )
    .all({ projectId }) as MemberRow[];
  const byColab = new Map<string, ColabMember[]>();
  for (const m of members) {
    const list = byColab.get(m.colab_id) ?? [];
    list.push(toMember(m));
    byColab.set(m.colab_id, list);
  }
  return colabs.map((c) => ({
    id: c.id,
    name: c.name,
    purpose: c.purpose,
    createdAt: c.created_at,
    members: byColab.get(c.id) ?? [],
  }));
}

export function createColab(db: Database.Database, name: string, purpose: string): string {
  const id = nanoid();
  db.prepare("INSERT INTO colabs (id, name, purpose, created_at) VALUES (?, ?, ?, ?)").run(
    id,
    name,
    purpose,
    Math.floor(Date.now() / 1000),
  );
  return id;
}

export function updateColab(
  db: Database.Database,
  id: string,
  name: string,
  purpose: string,
): void {
  db.prepare("UPDATE colabs SET name = ?, purpose = ? WHERE id = ?").run(name, purpose, id);
}

export function deleteColab(db: Database.Database, id: string): void {
  db.prepare("DELETE FROM colabs WHERE id = ?").run(id);
}

export function addColabMember(
  db: Database.Database,
  colabId: string,
  m: Omit<ColabMember, "projectName" | "main">,
): void {
  // The first member is the main one until the person picks another
  db.prepare(
    `INSERT INTO colab_members (colab_id, project_id, repo, role, main)
     VALUES (@colabId, @projectId, @repo, @role,
             NOT EXISTS (SELECT 1 FROM colab_members WHERE colab_id = @colabId AND main = 1))
     ON CONFLICT (colab_id, project_id, repo) DO UPDATE SET role = excluded.role`,
  ).run({ colabId, ...m });
}

/** One main member per colab: marking one clears the others */
export function setColabMain(
  db: Database.Database,
  colabId: string,
  projectId: string,
  repo: string,
  main: boolean,
): void {
  db.prepare(
    `UPDATE colab_members SET main = (@main AND project_id = @projectId AND repo = @repo)
     WHERE colab_id = @colabId AND (@main OR (project_id = @projectId AND repo = @repo))`,
  ).run({ colabId, projectId, repo, main: main ? 1 : 0 });
}

export function removeColabMember(
  db: Database.Database,
  colabId: string,
  projectId: string,
  repo: string,
): void {
  db.prepare("DELETE FROM colab_members WHERE colab_id = ? AND project_id = ? AND repo = ?").run(
    colabId,
    projectId,
    repo,
  );
}

export function isColabMember(db: Database.Database, colabId: string, projectId: string): boolean {
  return !!db
    .prepare("SELECT 1 FROM colab_members WHERE colab_id = ? AND project_id = ? LIMIT 1")
    .get(colabId, projectId);
}
