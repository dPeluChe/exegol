export interface Mention {
  name: string;
  kind: "project" | "session";
  /** A session's project */
  detail?: string;
}

const MAX_MENTIONS = 8;

/** The `@word` being typed right before the caret, if any */
export function mentionAt(text: string, caret: number): { start: number; query: string } | null {
  const query = /(?:^|\s)@([^\s@]*)$/.exec(text.slice(0, caret))?.[1];
  return query === undefined ? null : { start: caret - query.length - 1, query };
}

/** Names that start with the query first, then the ones that contain it */
export function matchMentions(items: Mention[], query: string): Mention[] {
  const q = query.toLowerCase();
  const rank = (m: Mention) => {
    if (m.name.toLowerCase().startsWith(q)) return 0;
    return `${m.name} ${m.detail ?? ""}`.toLowerCase().includes(q) ? 1 : -1;
  };
  return items
    .map((item) => ({ item, rank: rank(item) }))
    .filter((r) => r.rank >= 0)
    .sort((a, b) => a.rank - b.rank)
    .slice(0, MAX_MENTIONS)
    .map((r) => r.item);
}

/** The text with the typed `@word` replaced by the name, and where the caret goes */
export function applyMention(
  text: string,
  start: number,
  caret: number,
  name: string,
): { text: string; caret: number } {
  const inserted = `@${name} `;
  const rest = text.slice(caret).replace(/^ /, "");
  return { text: text.slice(0, start) + inserted + rest, caret: start + inserted.length };
}
