import { getDb } from "../db";

interface ProjectRow {
  id: string;
  name: string;
  path: string;
  default_branch: string;
  agent_count: number;
}

export function projectsCommand(): void {
  const db = getDb();
  const projects = db
    .prepare(
      `SELECT p.id, p.name, p.path, p.default_branch,
              COUNT(CASE WHEN a.status IN ('running','spawning','waiting_input') THEN 1 END) as agent_count
       FROM projects p
       LEFT JOIN agents a ON a.project_id = p.id
       GROUP BY p.id
       ORDER BY p.last_opened_at DESC`,
    )
    .all() as ProjectRow[];

  if (projects.length === 0) {
    console.log("No projects found.");
    return;
  }

  console.log(`\n  Projects (${projects.length})\n`);

  for (const proj of projects) {
    const agents =
      proj.agent_count > 0 ? `\x1b[32m${proj.agent_count} agent(s)\x1b[0m` : "\x1b[90mno agents\x1b[0m";
    console.log(`  ${proj.name.padEnd(20)} ${proj.default_branch.padEnd(12)} ${agents}`);
    console.log(`  \x1b[90m${proj.path}\x1b[0m`);
    console.log();
  }
}
