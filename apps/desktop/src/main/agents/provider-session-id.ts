import type { AgentCliType } from "@exegol/shared";
import { getProviderRegistry } from "./registry";

/**
 * The session id the PROVIDER knows this run by — the one its own on-disk store
 * files it under, and the one its resume flag takes.
 *
 * `claude_session_id` is captured only for claude-code (the parser gates on the
 * cli type), so using it as "the provider session id" made history dedupe work
 * for exactly one provider: a codex or opencode session launched by Exegol
 * appeared twice, once with its score and once as "outside Exegol".
 *
 * `resume_command` is captured for every provider and literally contains the id
 * (`codex resume <id>`, `opencode -s <id>`), with the prefix already declared as
 * `capabilities.resumeCommandPattern`. Derived at read time rather than stored,
 * so existing rows benefit without a backfill.
 */
export function providerSessionId(
  cliType: string,
  claudeSessionId: string | null,
  resumeCommand: string | null,
): string | null {
  if (claudeSessionId) return claudeSessionId;
  if (!resumeCommand) return null;

  const pattern = getProviderRegistry().get(cliType as AgentCliType)?.capabilities
    ?.resumeCommandPattern;
  const rest =
    pattern && resumeCommand.startsWith(pattern)
      ? resumeCommand.slice(pattern.length)
      : // No declared prefix: the id is the last word of the command either way.
        resumeCommand;

  const id = rest.trim().split(/\s+/)[0];
  return id ? id.replace(/^['"]|['"]$/g, "") : null;
}
