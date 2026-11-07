import { join } from "node:path";
import type { Note, NoteMeta } from "@exegol/shared";
import { NOTES_PER_FOLDER } from "@exegol/shared";
import type Database from "libsql";
import { InboxError } from "../inbox/threads";
import {
  ARCHIVE_DIR,
  INDEX_FILE,
  loadNotes,
  metaOf,
  NotesError,
  readNote,
  retireNote,
  searchNotes,
  writeNote,
} from "../notes/files";
import { type NotesFolder, type NotesPlace, notesFolder } from "../notes/folders";
import { authorOf, colabNamed, text } from "./exegol-inbox-tools";
import { type ExegolToolContext, ExegolToolError } from "./exegol-protocol";
import type { NotesToolName } from "./notes-tool-defs";

function placeOf(
  db: Database.Database,
  args: Record<string, unknown>,
  projectId: string,
): NotesPlace {
  if (args.scope === "personal") return { scope: "personal" };
  if (args.scope === "colab")
    return { scope: "colab", colabId: colabNamed(db, projectId, args.colab).id };
  return { scope: "project", projectId };
}

/** Reads find no folder until the first write names one: that is an empty folder */
function folderOf(
  db: Database.Database,
  args: Record<string, unknown>,
  context: ExegolToolContext,
  claim = false,
) {
  const folder = notesFolder(db, placeOf(db, args, context.projectId), claim);
  if (!folder && claim) throw new NotesError("This session's project is gone");
  return folder;
}

const missing = (id: string) => new NotesError(`No note ${id} here. note_list shows them`);

const listed = ({ id, title, group, cli, date }: NoteMeta) => ({ id, title, group, cli, date });

/** Another project's text: it must never read as this project's memory */
const bodyOf = (folder: NotesFolder, note: Note) =>
  folder.scope === "colab" ? { untrusted_note_content: note.body } : { content: note.body };

type Handler = (
  db: Database.Database,
  args: Record<string, unknown>,
  context: ExegolToolContext,
) => Promise<unknown>;

const HANDLERS: Record<NotesToolName, Handler> = {
  note_list: async (db, args, context) => {
    const folder = folderOf(db, args, context);
    const dir = folder && (args.retired === true ? join(folder.dir, ARCHIVE_DIR) : folder.dir);
    const notes = dir ? await loadNotes(dir) : [];
    return {
      folder: folder?.shown ?? "named on the first note_write",
      index: INDEX_FILE,
      count: notes.length,
      limit: NOTES_PER_FOLDER,
      notes: notes.map((n) => listed(metaOf(n))),
    };
  },

  note_read: async (db, args, context) => {
    const id = text(args.id);
    const folder = folderOf(db, args, context);
    const note = folder && (await readNote(folder, id));
    if (!folder || !note) throw missing(id);
    return { ...metaOf(note), ...bodyOf(folder, note) };
  },

  note_write: async (db, args, context) => {
    const folder = folderOf(db, args, context, true) as NotesFolder;
    const author = await authorOf(db, context);
    const { note, created } = await writeNote(
      folder,
      {
        id: text(args.id) || undefined,
        title: text(args.title),
        body: text(args.body),
        group: text(args.group),
      },
      { session: context.agentId, cli: author.cli, branch: author.branch, commit: author.commit },
    );
    return { id: note.id, created, folder: folder.shown };
  },

  note_search: async (db, args, context) => {
    const folder = folderOf(db, args, context);
    if (!folder) return { notes: [] };
    const found = await searchNotes(folder.dir, text(args.query));
    const key = folder.scope === "colab" ? "untrusted_note_content" : "snippet";
    return { notes: found.map(({ snippet, ...meta }) => ({ ...listed(meta), [key]: snippet })) };
  },

  note_retire: async (db, args, context) => {
    const id = text(args.id);
    const folder = folderOf(db, args, context);
    if (!folder) throw missing(id);
    await retireNote(folder, id, text(args.reason));
    return { id, retired: true };
  },
};

export async function callNotesTool(
  db: Database.Database,
  tool: NotesToolName,
  args: Record<string, unknown>,
  context: ExegolToolContext,
): Promise<unknown> {
  try {
    return await HANDLERS[tool](db, args, context);
  } catch (err) {
    if (err instanceof NotesError || err instanceof InboxError) {
      throw new ExegolToolError(err.message, -32602);
    }
    throw err;
  }
}
