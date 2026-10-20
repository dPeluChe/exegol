interface Session {
  cliType: string;
  folder?: string | null;
}

const trimSlash = (p: string) => (p.length > 1 ? p.replace(/\/+$/, "") : p);

/** Same folder; a session with none recorded ran at the project root */
export function sameFolder(
  session: string | null | undefined,
  folder: string,
  projectPath: string,
): boolean {
  return trimSlash(session || projectPath) === trimSlash(folder);
}

/**
 * Past sessions of one agent (or any, with no providerId) in the launcher's folder. With none
 * there, the agent's sessions elsewhere in the project, marked "project" so the picker says so
 */
export function sessionsInFolder<T extends Session>(
  sessions: T[],
  opts: { providerId?: string; folder: string; projectPath: string },
): { sessions: T[]; scope: "folder" | "project" } {
  const ofAgent = opts.providerId
    ? sessions.filter((s) => s.cliType === opts.providerId)
    : sessions;
  const here = ofAgent.filter((s) => sameFolder(s.folder, opts.folder, opts.projectPath));
  if (here.length > 0 || ofAgent.length === 0) return { sessions: here, scope: "folder" };
  return { sessions: ofAgent, scope: "project" };
}
