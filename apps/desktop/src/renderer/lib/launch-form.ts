/** The model dropdown's Default: which model it is when the CLI's settings say so */
export function defaultModelLabel(cliDefault: { model: string; source: string } | null): string {
  return cliDefault
    ? `Default · ${cliDefault.model} (from ${cliDefault.source})`
    : "Default (the CLI's own setting)";
}

interface PastSession {
  agentId: string;
  alias: string | null;
}

/**
 * The Name row under Session: an input for a new session; a resumed one already has a name, so
 * it shows that (the CLI's own name, else the codename). Continue last shows the newest session
 * this CLI recorded in the folder when Exegol can read it
 */
export function sessionNameDisplay(opts: {
  session: PastSession | "last" | null;
  localSessionId: string | null;
  cliNames: Record<string, string>;
  localSessions: { sessionId: string; name?: string | null; title: string | null }[];
}): { input: true } | { input: false; name: string } {
  const { session, localSessionId, cliNames, localSessions } = opts;
  const localName = (id: string | undefined) => {
    const s = localSessions.find((l) => l.sessionId === id);
    return s ? (s.name ?? s.title ?? s.sessionId.slice(0, 8)) : null;
  };
  if (localSessionId) return { input: false, name: localName(localSessionId) ?? "Claude session" };
  if (session === "last") {
    return {
      input: false,
      name: localName(localSessions[0]?.sessionId) ?? "the last session here",
    };
  }
  if (session) {
    return { input: false, name: cliNames[session.agentId] ?? session.alias ?? "past session" };
  }
  return { input: true };
}
