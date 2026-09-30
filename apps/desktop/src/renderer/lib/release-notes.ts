interface NotesSection {
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
