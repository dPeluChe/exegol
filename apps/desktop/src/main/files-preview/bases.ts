import type Database from "libsql";
import { listProjects } from "../db/queries";

/** Roots a preview may be served from: every project and Exegol worktree, never ~/.exegol */
export function previewBases(db: Database.Database): string[] {
  const worktrees = db.prepare("SELECT path FROM worktrees").all() as { path: string }[];
  return [...listProjects(db).map((p) => p.path), ...worktrees.map((w) => w.path)];
}
