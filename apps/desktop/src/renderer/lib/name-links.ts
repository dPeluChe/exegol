export interface NameLink {
  name: string;
  /** `exegol:session:<agentId>:<projectId>` or `exegol:project:<projectId>` */
  href: string;
}

export const JUMP_SCHEME = "exegol:";

export const sessionHref = (agentId: string, projectId: string) =>
  `${JUMP_SCHEME}session:${agentId}:${projectId}`;
export const projectHref = (projectId: string) => `${JUMP_SCHEME}project:${projectId}`;

export function parseJump(
  href: string,
):
  | { kind: "session"; agentId: string; projectId: string }
  | { kind: "project"; projectId: string }
  | null {
  if (!href.startsWith(JUMP_SCHEME)) return null;
  const [kind, a, b] = href.slice(JUMP_SCHEME.length).split(":");
  if (kind === "session" && a && b) return { kind, agentId: a, projectId: b };
  if (kind === "project" && a) return { kind, projectId: a };
  return null;
}

const MIN_NAME = 3;
const literal = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Cuts a text at each whole-word, same-case name. The first link of a name wins, and names
 *  under 3 characters are left alone: too easy to hit by chance */
export function nameSplitter(links: NameLink[]): (text: string) => (string | NameLink)[] {
  const byName = new Map<string, NameLink>();
  for (const link of links) {
    if (link.name.length >= MIN_NAME && !byName.has(link.name)) byName.set(link.name, link);
  }
  if (byName.size === 0) return (text) => [text];
  const names = [...byName.keys()].sort((a, b) => b.length - a.length).map(literal);
  const pattern = new RegExp(`(?<![\\p{L}\\p{N}_-])(${names.join("|")})(?![\\p{L}\\p{N}_-])`, "gu");
  return (text) => {
    const parts: (string | NameLink)[] = [];
    let at = 0;
    for (const match of text.matchAll(pattern)) {
      const link = byName.get(match[0]);
      if (!link) continue;
      if (match.index > at) parts.push(text.slice(at, match.index));
      parts.push(link);
      at = match.index + match[0].length;
    }
    if (at < text.length) parts.push(text.slice(at));
    return parts;
  };
}
