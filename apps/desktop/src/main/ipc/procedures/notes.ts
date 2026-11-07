import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  NOTE_BODY_MAX,
  NOTE_GROUP_MAX,
  NOTE_TITLE_MAX,
  type NotesListing,
  type NotesPlace,
} from "@exegol/shared";
import { TRPCError } from "@trpc/server";
import { shell } from "electron";
import { z } from "zod";
import {
  ARCHIVE_DIR,
  deleteNote,
  loadNotes,
  NotesError,
  noteIds,
  PERSON_AUTHOR,
  restoreNote,
  retireNote,
  writeNote,
} from "../../notes/files";
import { type NotesFolder, notesFolder, notifyNotesChanged } from "../../notes/folders";
import { publicProcedure, router } from "../trpc";

const place: z.ZodType<NotesPlace> = z.discriminatedUnion("scope", [
  z.object({ scope: z.literal("project"), projectId: z.string() }),
  z.object({ scope: z.literal("colab"), colabId: z.string() }),
  z.object({ scope: z.literal("personal") }),
]);
const one = z.object({ place, id: z.string() });

/** A rule the person can hit reads as one, not as an internal error */
async function changed<T>(run: () => Promise<T>): Promise<T> {
  try {
    const out = await run();
    notifyNotesChanged();
    return out;
  } catch (err) {
    if (err instanceof NotesError)
      throw new TRPCError({ code: "BAD_REQUEST", message: err.message });
    throw err;
  }
}

function existing(folder: NotesFolder | null): NotesFolder {
  if (!folder) throw new TRPCError({ code: "NOT_FOUND", message: "No notes here yet" });
  return folder;
}

/** The person's view: edits keep the author, delete is theirs only. Changes push `notes:changed` */
export const notesRouter = router({
  list: publicProcedure
    .input(z.object({ place, retired: z.boolean().default(false) }))
    .query(async ({ ctx, input }): Promise<NotesListing> => {
      const folder = notesFolder(ctx.db, input.place);
      if (!folder) return { folder: null, notes: [], active: 0, retired: 0 };
      const archive = join(folder.dir, ARCHIVE_DIR);
      const [notes, other] = await Promise.all([
        loadNotes(input.retired ? archive : folder.dir),
        noteIds(input.retired ? folder.dir : archive),
      ]);
      const [active, retired] = input.retired
        ? [other.length, notes.length]
        : [notes.length, other.length];
      return { folder: folder.shown, notes, active, retired };
    }),

  save: publicProcedure
    .input(
      z.object({
        place,
        id: z.string().optional(),
        title: z.string().max(NOTE_TITLE_MAX),
        body: z.string().max(NOTE_BODY_MAX),
        group: z.string().max(NOTE_GROUP_MAX).optional(),
      }),
    )
    .mutation(({ ctx, input: { place: at, ...note } }) =>
      changed(async () => {
        const folder = existing(notesFolder(ctx.db, at, true));
        return (await writeNote(folder, note, PERSON_AUTHOR)).note;
      }),
    ),

  retire: publicProcedure
    .input(one.extend({ reason: z.string() }))
    .mutation(({ ctx, input }) =>
      changed(() => retireNote(existing(notesFolder(ctx.db, input.place)), input.id, input.reason)),
    ),

  restore: publicProcedure
    .input(one)
    .mutation(({ ctx, input }) =>
      changed(() => restoreNote(existing(notesFolder(ctx.db, input.place)), input.id)),
    ),

  delete: publicProcedure
    .input(one)
    .mutation(({ ctx, input }) =>
      changed(() => deleteNote(existing(notesFolder(ctx.db, input.place)), input.id)),
    ),

  openFolder: publicProcedure.input(z.object({ place })).mutation(async ({ ctx, input }) => {
    const folder = notesFolder(ctx.db, input.place);
    if (!folder || !existsSync(folder.dir)) return { opened: false };
    return { opened: (await shell.openPath(folder.dir)) === "" };
  }),
});
