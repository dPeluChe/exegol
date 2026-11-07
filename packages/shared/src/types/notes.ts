export const NOTE_SCOPES = ["project", "colab", "personal"] as const;
export type NoteScope = (typeof NOTE_SCOPES)[number];

/** First guesses (design doc section 7): over them note_write refuses and lists the oldest */
export const NOTES_PER_FOLDER = 40;
export const NOTE_BODY_MAX = 2_000;
export const NOTE_TITLE_MAX = 120;
export const NOTE_GROUP_MAX = 40;
export const NOTE_DEFAULT_GROUP = "General";

/** A note's frontmatter. A file a person wrote by hand may lack all but its id */
export interface NoteMeta {
  /** The file name without .md */
  id: string;
  title: string;
  group: string;
  /** Agent id of the session that wrote it; null when a person did */
  session: string | null;
  cli: string | null;
  /** ISO time of the last write */
  date: string;
  branch: string | null;
  commit: string | null;
  retiredAt?: string;
  retiredReason?: string;
}

export interface Note extends NoteMeta {
  body: string;
}

export type NotesPlace =
  | { scope: "project"; projectId: string }
  | { scope: "colab"; colabId: string }
  | { scope: "personal" };

/** The Notes view: one set at a time, so the uncapped archive loads only when asked */
export interface NotesListing {
  /** Home-relative; null until the first note names the folder */
  folder: string | null;
  notes: Note[];
  active: number;
  retired: number;
}

/** Index and view order: groups A to Z, notes as given (newest first) */
export function groupNotes<T extends Pick<NoteMeta, "group">>(notes: T[]): [string, T[]][] {
  const groups = new Map<string, T[]>();
  for (const n of notes) {
    const list = groups.get(n.group);
    if (list) list.push(n);
    else groups.set(n.group, [n]);
  }
  return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b));
}

/** One rule for note_search and the view's search box; `query` already lowercased */
export const noteMatches = (note: Pick<Note, "title" | "body">, query: string) =>
  `${note.title}\n${note.body}`.toLowerCase().includes(query);

/** `base`, else `base-2`, `base-3`: folder and note names alike */
export function freeName(base: string, taken: (name: string) => unknown): string {
  let name = base;
  for (let n = 2; taken(name); n++) name = `${base}-${n}`;
  return name;
}
