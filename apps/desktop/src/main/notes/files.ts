import { mkdir, readdir, readFile, stat, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  NOTE_BODY_MAX,
  NOTE_DEFAULT_GROUP,
  NOTE_GROUP_MAX,
  NOTE_TITLE_MAX,
  NOTES_PER_FOLDER,
  type Note,
  type NoteMeta,
} from "@exegol/shared";
import { parseFrontmatter } from "../lib/frontmatter";
import { folderSlug, type NotesFolder } from "./folders";

export class NotesError extends Error {}

export const INDEX_FILE = "README.md";
export const ARCHIVE_DIR = "archive";
const READ_MAX = 20_000;
const OLDEST_SHOWN = 5;

export interface NoteAuthor {
  session: string | null;
  cli: string | null;
  branch: string | null;
  commit: string | null;
}

const oneLine = (v: string) => v.replace(/[\r\n]+/g, " ").trim();

const FIELDS: [keyof NoteMeta, string][] = [
  ["title", "title"],
  ["group", "group"],
  ["session", "session"],
  ["cli", "cli"],
  ["date", "date"],
  ["branch", "branch"],
  ["commit", "commit"],
  ["retiredAt", "retired"],
  ["retiredReason", "retired_reason"],
];
const OPTIONAL = new Set<keyof NoteMeta>(["retiredAt", "retiredReason"]);

/** A file a person wrote by hand may lack any field: its id stands in for the title */
export function parseNote(id: string, text: string): Note {
  const { meta, body } = parseFrontmatter(text);
  const fields: Record<string, string | null> = {};
  for (const [key, name] of FIELDS) {
    if (meta[name] || !OPTIONAL.has(key)) fields[key] = meta[name] || null;
  }
  return {
    ...(fields as unknown as NoteMeta),
    id,
    title: fields.title ?? id,
    group: fields.group ?? NOTE_DEFAULT_GROUP,
    date: fields.date ?? "",
    body: body.trim(),
  };
}

export function serializeNote(note: Note): string {
  const lines = FIELDS.flatMap(([key, name]) => {
    const value = note[key];
    return typeof value === "string" && value ? [`${name}: ${oneLine(value)}`] : [];
  });
  return `---\n${lines.join("\n")}\n---\n\n${note.body.trim()}\n`;
}

/** A file name a person may have picked too, never a path */
export function checkId(id: string): string {
  if (!id || id.length > NOTE_TITLE_MAX || /[/\\]/.test(id) || id.startsWith(".")) {
    throw new NotesError(`Not a note id: ${JSON.stringify(id)}`);
  }
  if (id === INDEX_FILE.slice(0, -3)) throw new NotesError("README is the index, not a note");
  return id;
}

async function readOne(dir: string, id: string): Promise<Note | null> {
  const file = join(dir, `${id}.md`);
  try {
    const note = parseNote(id, (await readFile(file, "utf8")).slice(0, READ_MAX));
    if (!note.date) note.date = (await stat(file)).mtime.toISOString();
    return note;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

export async function noteIds(dir: string): Promise<string[]> {
  const names = await readdir(dir).catch((err: NodeJS.ErrnoException) => {
    if (err.code === "ENOENT") return [] as string[];
    throw err;
  });
  return names
    .filter((n) => n.endsWith(".md") && n !== INDEX_FILE && !n.startsWith("."))
    .map((n) => n.slice(0, -3));
}

const newestFirst = (a: NoteMeta, b: NoteMeta) => b.date.localeCompare(a.date);

/** Newest first, bodies included: a folder holds 40 notes of 2,000 characters at most */
export async function loadNotes(dir: string): Promise<Note[]> {
  const notes = await Promise.all((await noteIds(dir)).map((id) => readOne(dir, id)));
  return notes.filter((n): n is Note => n !== null).sort(newestFirst);
}

export const metaOf = ({ body: _, ...meta }: Note): NoteMeta => meta;

export async function readNote(folder: NotesFolder, id: string): Promise<Note | null> {
  checkId(id);
  return (await readOne(folder.dir, id)) ?? readOne(join(folder.dir, ARCHIVE_DIR), id);
}

const locks = new Map<string, Promise<unknown>>();

/** Two sessions writing at once would each rebuild the index from a stale list */
function withLock<T>(dir: string, fn: () => Promise<T>): Promise<T> {
  const run = (locks.get(dir) ?? Promise.resolve()).then(fn, fn);
  const tail = run.catch(() => undefined);
  locks.set(dir, tail);
  void tail.then(() => locks.get(dir) === tail && locks.delete(dir));
  return run;
}

export function renderIndex(folder: NotesFolder, notes: NoteMeta[]): string {
  const groups = new Map<string, NoteMeta[]>();
  for (const n of notes) groups.set(n.group, [...(groups.get(n.group) ?? []), n]);
  const sections = [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([group, list]) => {
      const lines = list.map((n) => {
        const by = [n.date.slice(0, 10), n.cli ?? (n.session ? null : "person")].filter(Boolean);
        return `- [${n.title}](${encodeURI(n.id)}.md) ${by.join(", ")}`;
      });
      return `## ${group}\n\n${lines.join("\n")}`;
    });
  return [
    `# Notes: ${folder.name}`,
    `Written by Exegol on every change: edit the notes, not this file. ${notes.length} of ${NOTES_PER_FOLDER}.`,
    ...sections,
  ].join("\n\n");
}

/** From the list the caller already holds: the folder is locked, so it is current */
const writeIndex = (folder: NotesFolder, notes: NoteMeta[]) =>
  writeFile(join(folder.dir, INDEX_FILE), `${renderIndex(folder, notes)}\n`);

async function freeId(dir: string, title: string, live: Note[]): Promise<string> {
  const base = folderSlug(title, "note");
  const taken = new Set([...live.map((n) => n.id), ...(await noteIds(join(dir, ARCHIVE_DIR)))]);
  let id = base;
  for (let n = 2; taken.has(id); n++) id = `${base}-${n}`;
  return id;
}

export interface NoteInput {
  /** Rewrites a note this session wrote; omitted for a new one */
  id?: string;
  title: string;
  body: string;
  group?: string;
}

function checkInput(input: NoteInput) {
  const title = oneLine(input.title);
  const body = input.body.trim();
  if (!title) throw new NotesError("A note needs a title");
  if (!body) throw new NotesError("A note needs a body");
  if (title.length > NOTE_TITLE_MAX) {
    throw new NotesError(`Title is ${title.length} characters, at most ${NOTE_TITLE_MAX}`);
  }
  if (body.length > NOTE_BODY_MAX) {
    throw new NotesError(
      `Body is ${body.length} characters, at most ${NOTE_BODY_MAX}: keep what a later session needs`,
    );
  }
  const group = oneLine(input.group ?? "").slice(0, NOTE_GROUP_MAX) || NOTE_DEFAULT_GROUP;
  return { title, body, group };
}

export async function writeNote(
  folder: NotesFolder,
  input: NoteInput,
  author: NoteAuthor,
): Promise<{ note: NoteMeta; created: boolean }> {
  const fields = checkInput(input);
  return withLock(folder.dir, async () => {
    await mkdir(folder.dir, { recursive: true });
    const notes = await loadNotes(folder.dir);
    let id: string;
    if (input.id) {
      id = checkId(input.id);
      const own = notes.find((n) => n.id === id);
      if (!own) throw new NotesError(`No note ${id} here. note_list shows them`);
      if (!own.session || own.session !== author.session) {
        throw new NotesError(
          `${id} was written by another session: add a new note, or retire it with note_retire and a reason`,
        );
      }
    } else {
      if (notes.length >= NOTES_PER_FOLDER) {
        const oldest = notes
          .slice(-OLDEST_SHOWN)
          .map((n) => `${n.id} (${n.date.slice(0, 10)}, ${n.title})`);
        throw new NotesError(
          `This folder holds ${NOTES_PER_FOLDER} notes, its limit. Update one you wrote or retire ` +
            `one with note_retire. Oldest: ${oldest.join("; ")}`,
        );
      }
      id = await freeId(folder.dir, fields.title, notes);
    }
    const note: Note = { id, ...fields, ...author, date: new Date().toISOString() };
    await writeFile(join(folder.dir, `${id}.md`), serializeNote(note));
    const meta = metaOf(note);
    await writeIndex(folder, [meta, ...notes.filter((n) => n.id !== id).map(metaOf)]);
    return { note: meta, created: !input.id };
  });
}

/** Any session of the folder may retire a note: the one that wrote it is usually gone */
export async function retireNote(folder: NotesFolder, id: string, reason: string): Promise<void> {
  checkId(id);
  const why = oneLine(reason);
  if (!why) throw new NotesError("Say why it is retired: one line");
  await withLock(folder.dir, async () => {
    const notes = await loadNotes(folder.dir);
    const note = notes.find((n) => n.id === id);
    if (!note) throw new NotesError(`No note ${id} here. note_list shows them`);
    const archive = join(folder.dir, ARCHIVE_DIR);
    await mkdir(archive, { recursive: true });
    const retired = { ...note, retiredAt: new Date().toISOString(), retiredReason: why };
    await writeFile(join(archive, `${id}.md`), serializeNote(retired));
    await unlink(join(folder.dir, `${id}.md`));
    await writeIndex(folder, notes.filter((n) => n.id !== id).map(metaOf));
  });
}

const SNIPPET = 160;

export async function searchNotes(dir: string, query: string, limit = 20) {
  const q = query.trim().toLowerCase();
  if (!q) throw new NotesError("Search needs a query");
  return (await loadNotes(dir))
    .filter((n) => `${n.title}\n${n.body}`.toLowerCase().includes(q))
    .slice(0, limit)
    .map((n) => {
      const at = Math.max(n.body.toLowerCase().indexOf(q) - SNIPPET / 4, 0);
      return { ...metaOf(n), snippet: n.body.slice(at, at + SNIPPET) };
    });
}
