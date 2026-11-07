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
  repo: string;
  role: string;
}

const toMember = (r: MemberRow): ColabMember => ({
  projectId: r.project_id,
  repo: r.repo,
  role: r.role,
});

export function listColabs(db: Database.Database): Colab[] {
  const colabs = db.prepare("SELECT * FROM colabs ORDER BY name").all() as ColabRow[];
  const members = db
    .prepare("SELECT * FROM colab_members ORDER BY project_id, repo")
    .all() as MemberRow[];
  return colabs.map((c) => ({
    id: c.id,
    name: c.name,
    purpose: c.purpose,
    createdAt: c.created_at,
    members: members.filter((m) => m.colab_id === c.id).map(toMember),
  }));
}

export function getColab(db: Database.Database, id: string): Colab | null {
  return listColabs(db).find((c) => c.id === id) ?? null;
}

/** The colabs a project is in */
export function colabsOfProject(db: Database.Database, projectId: string): Colab[] {
  return listColabs(db).filter((c) => c.members.some((m) => m.projectId === projectId));
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

export function addColabMember(db: Database.Database, colabId: string, m: ColabMember): void {
  db.prepare(
    `INSERT INTO colab_members (colab_id, project_id, repo, role) VALUES (?, ?, ?, ?)
     ON CONFLICT (colab_id, project_id, repo) DO UPDATE SET role = excluded.role`,
  ).run(colabId, m.projectId, m.repo, m.role);
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
