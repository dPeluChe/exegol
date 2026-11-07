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
