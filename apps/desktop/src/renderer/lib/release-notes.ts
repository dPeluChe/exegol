export interface NotesSection {
  /** "Added", "Fixed"... null for lines before the first heading */
  title: string | null;
  items: string[];
}

/** A release body (the CHANGELOG section for that version) as headings with their bullets */
export function parseReleaseNotes(body: string): NotesSection[] {
  const sections: NotesSection[] = [];
  let current: NotesSection = { title: null, items: [] };
  for (const raw of body.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    const heading = line.match(/^#{1,6}\s+(.*)$/);
    if (heading) {
      if (current.items.length > 0) sections.push(current);
      current = { title: heading[1] ?? "", items: [] };
      continue;
    }
    const bullet = line.match(/^[-*]\s+(.*)$/);
    if (bullet) current.items.push(bullet[1] ?? "");
    else if (current.items.length > 0) {
      // A wrapped bullet continues the previous one
      current.items[current.items.length - 1] += ` ${line}`;
    } else current.items.push(line);
  }
  if (current.items.length > 0) sections.push(current);
  return sections;
}

export type NotesFilter = "all" | "added" | "changed" | "fixed";
export type NotesKind = Exclude<NotesFilter, "all">;
export const NOTES_KINDS: NotesKind[] = ["added", "changed", "fixed"];

export function sectionKind(title: string | null): NotesKind | null {
  const kind = title?.trim().toLowerCase();
  return NOTES_KINDS.find((k) => k === kind) ?? null;
}

const HEADLINE_PREFIX_MAX = 60;
const HEADLINE_MAX = 110;

function balancedTicks(text: string): boolean {
  return (text.match(/`/g)?.length ?? 0) % 2 === 0;
}

/** One line per entry: the short "Name: ..." prefix, else the first sentence, cut at a word */
export function noteHeadline(text: string): string {
  const colon = text.indexOf(": ");
  if (colon > 0 && colon <= HEADLINE_PREFIX_MAX && balancedTicks(text.slice(0, colon))) {
    return text.slice(0, colon);
  }
  const sentence = text.match(/^.*?[.!?](?=\s|$)/)?.[0] ?? text;
  if (sentence.length <= HEADLINE_MAX) return sentence.replace(/\.$/, "");
  const cut = sentence.slice(0, HEADLINE_MAX);
  const space = cut.lastIndexOf(" ");
  const head = (space > HEADLINE_MAX / 2 ? cut.slice(0, space) : cut).replace(/[,;:]$/, "");
  return balancedTicks(head) ? `${head}…` : `${head}\`…`;
}

export function countByKind(sections: NotesSection[]): Record<NotesKind, number> {
  const counts: Record<NotesKind, number> = { added: 0, changed: 0, fixed: 0 };
  for (const section of sections) {
    const kind = sectionKind(section.title);
    if (kind) counts[kind] += section.items.length;
  }
  return counts;
}

export function filterSections(sections: NotesSection[], filter: NotesFilter): NotesSection[] {
  return filter === "all" ? sections : sections.filter((s) => sectionKind(s.title) === filter);
}
