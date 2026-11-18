/** Names as a person or an agent types them: case and outer spaces do not count */
export const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

export const SESSION_NAME_MAX = 40;

/** What a rename inside the CLI changes: null when that name was already read */
export function renameEffect(
  agent: { alias?: string | null; cliName?: string | null },
  renamed: string | null,
): { cliName: string; alias: string | null } | null {
  const cliName = renamed?.trim().slice(0, SESSION_NAME_MAX).trim();
  if (!cliName || cliName === agent.cliName) return null;
  return { cliName, alias: agent.alias && sameName(agent.alias, cliName) ? null : cliName };
}
