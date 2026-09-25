import type { AgentCliType } from "@exegol/shared";
import type Database from "libsql";
import { findLostSession } from "../history";
import { logger } from "../lib/logger";
import { providerSessionId } from "./provider-session-id";
import { getProviderRegistry } from "./registry";

/**
 * Resume needs the provider's session id. A reboot or crash kills the PTY
 * before the CLI prints its resume line, and without the id Resume fell back
 * to "continue the latest" (every crashed agent of a project reopened the
 * same conversation). Find the agent's own session in the CLI's store and
 * store it on the row, so the normal resume path picks it up.
 */
export async function recoverLostSessionId(
  db: Database.Database,
  agentId: string,
  cwd: string,
): Promise<void> {
  const row = db
    .prepare(
      "SELECT cli_type, started_at, claude_session_id, resume_command FROM agents WHERE id = ?",
    )
    .get(agentId) as
    | {
        cli_type: string;
        started_at: number | null;
        claude_session_id: string | null;
        resume_command: string | null;
      }
    | undefined;
  if (!row?.started_at || row.claude_session_id || row.resume_command) return;

  const isClaude = row.cli_type === "claude-code";
  const pattern = getProviderRegistry().get(row.cli_type as AgentCliType)?.capabilities
    ?.resumeCommandPattern;
  if (!isClaude && !pattern) return;

  const claimed = new Set(
    (
      db
        .prepare(
          "SELECT cli_type, claude_session_id, resume_command FROM agents WHERE cli_type = ? AND (claude_session_id IS NOT NULL OR resume_command IS NOT NULL)",
        )
        .all(row.cli_type) as {
        cli_type: string;
        claude_session_id: string | null;
        resume_command: string | null;
      }[]
    ).flatMap((r) => providerSessionId(r.cli_type, r.claude_session_id, r.resume_command) ?? []),
  );

  const session = await findLostSession(row.cli_type, cwd, row.started_at, claimed);
  if (!session) return;
  if (isClaude) {
    db.prepare("UPDATE agents SET claude_session_id = ? WHERE id = ?").run(
      session.sessionId,
      agentId,
    );
  } else {
    db.prepare("UPDATE agents SET resume_command = ? WHERE id = ?").run(
      `${pattern}${session.sessionId}`,
      agentId,
    );
  }
  logger.info(`[Resume] Found ${row.cli_type} session for ${agentId} in the CLI's own store`);
}
