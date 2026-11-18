/** Names as a person or an agent types them: case and outer spaces do not count */
export const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

export const SESSION_NAME_MAX = 40;
/** A title the CLI wrote by itself is only shown, so it may run longer than a name */
export const CLI_NAME_MAX = 80;

/** A session's name inside its CLI: `renamed` when only the person's rename writes it there */
export type CliName = { name: string | null; renamed: boolean };

/** What a name read from the CLI changes: null when it was already read. Only a rename moves
 *  the alias; a title the CLI gave by itself is kept beside it */
export function renameEffect(
  agent: { alias?: string | null; cliName?: string | null },
  read: CliName,
): { cliName: string; alias: string | null } | null {
  const max = read.renamed ? SESSION_NAME_MAX : CLI_NAME_MAX;
  const cliName = read.name?.trim().slice(0, max).trim();
  if (!cliName || cliName === agent.cliName) return null;
  const moves = read.renamed && !(agent.alias && sameName(agent.alias, cliName));
  return { cliName, alias: moves ? cliName : null };
}

/** The CLI's name for a session, when it says more than the name it already shows */
export const otherCliName = (agent: { alias?: string | null; cliName?: string | null }) =>
  agent.cliName && !sameName(agent.cliName, agent.alias ?? "") ? agent.cliName : null;
