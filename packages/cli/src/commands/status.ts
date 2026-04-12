import { getDb } from "../db";

interface AgentRow {
  id: string;
  cli_type: string;
  status: string;
  task_description: string;
  project_name: string;
  started_at: number | null;
}

export function statusCommand(): void {
  const db = getDb();
  const agents = db
    .prepare(
      `SELECT a.id, a.cli_type, a.status, a.task_description, a.started_at,
              p.name as project_name
       FROM agents a
       JOIN projects p ON a.project_id = p.id
       WHERE a.status IN ('running', 'spawning', 'waiting_input', 'paused')
       ORDER BY a.started_at DESC`,
    )
    .all() as AgentRow[];

  if (agents.length === 0) {
    console.log("No active agents.");
    return;
  }

  console.log(`\n  Active Agents (${agents.length})\n`);

  for (const agent of agents) {
    const elapsed = agent.started_at
      ? `${Math.floor((Date.now() / 1000 - agent.started_at) / 60)}m`
      : "?";
    const statusIcon =
      agent.status === "running"
        ? "\x1b[32m●\x1b[0m"
        : agent.status === "waiting_input"
          ? "\x1b[33m●\x1b[0m"
          : "\x1b[90m●\x1b[0m";
    console.log(
      `  ${statusIcon} ${agent.cli_type.padEnd(14)} ${agent.project_name.padEnd(16)} ${agent.task_description.slice(0, 40).padEnd(42)} ${elapsed}`,
    );
  }
  console.log();
}
