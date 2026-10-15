import {
  DICTATION_CANCEL_SOURCES,
  DICTATION_INPUTS,
  DICTATION_STOP_REASONS,
  DICTATION_TARGET_KINDS,
} from "@exegol/shared";
import { clipboard, ipcMain, shell } from "electron";
import { z } from "zod";
import { insertTextInBrowserPane, markDictationPage } from "../../browser/electron-host";
import { getProject } from "../../db/queries/projects";
import {
  clearDictations,
  deleteDictation,
  getDictation,
  listDictations,
} from "../../dictation/history";
import { setDictationListening } from "../../dictation/keys";
import { askMediaConsent } from "../../dictation/media-pause";
import { armMicTest, askMic, openMicSettings } from "../../dictation/mic";
import {
  clearRecordings,
  ensureRecordingsDir,
  recordingsSummary,
} from "../../dictation/recordings";
import {
  cancelDictation,
  dictationActive,
  dictationAudio,
  dictationStatus,
  pauseDictation,
  startDictation,
  stopDictation,
  warmDictation,
} from "../../dictation/service";
import { invalidateStorageReport } from "../../system/storage";
import { publicProcedure, router } from "../trpc";

const sessionId = z.string().regex(/^[A-Za-z0-9_-]{8,32}$/);
/** The target's project at start: its vocabulary joins the global one */
const projectId = z.string().max(64).nullable().optional();
const historyId = z.object({ id: z.string().regex(/^[A-Za-z0-9_-]{1,32}$/) });

/** Local voice dictation (T201): mic permission, sessions, history (Settings > Dictation) */
export const dictationRouter = router({
  status: publicProcedure.query(({ ctx }) => dictationStatus(ctx.db)),

  /** Every dictation start: the macOS prompt when not asked yet, then arms the main window's
   *  getUserMedia for a few seconds (media is denied everywhere else) */
  requestMic: publicProcedure.mutation(async () => ({ mic: await askMic() })),

  openMicSettings: publicProcedure.mutation(() => {
    openMicSettings();
    return { ok: true };
  }),

  /** Turning on direct Music/Spotify control: the Automation prompt now, not mid-dictation */
  mediaConsent: publicProcedure.mutation(() => askMediaConsent()),

  warm: publicProcedure
    .input(z.object({ projectId }).optional())
    .mutation(({ ctx, input }) => warmDictation(ctx.db, input?.projectId ?? null)),

  /** Audio then arrives on `dictation:audio`; partial text on `dictation:partial` */
  start: publicProcedure
    .input(z.object({ input: z.enum(DICTATION_INPUTS).default("default"), projectId }).optional())
    .mutation(({ ctx, input }) => startDictation(ctx.db, input?.input, input?.projectId ?? null)),

  pause: publicProcedure
    .input(z.object({ sessionId, paused: z.boolean() }))
    .mutation(({ input }) => pauseDictation(input.sessionId, input.paused)),

  stop: publicProcedure
    .input(
      z.object({
        sessionId,
        durationMs: z.number().min(0).max(3_600_000),
        projectId: z.string().max(64).nullable(),
        targetKind: z.enum(DICTATION_TARGET_KINDS),
        by: z.enum(DICTATION_STOP_REASONS),
      }),
    )
    .mutation(({ ctx, input }) => stopDictation(ctx.db, input)),

  cancel: publicProcedure
    .input(z.object({ sessionId, source: z.enum(DICTATION_CANCEL_SOURCES) }))
    .mutation(({ input }) => {
      cancelDictation(input.sessionId, input.source);
      return { ok: true };
    }),

  history: publicProcedure
    .input(z.object({ limit: z.number().int().min(1).max(500).default(100) }))
    .query(({ ctx, input }) => listDictations(ctx.db, input.limit)),

  deleteHistory: publicProcedure.input(historyId).mutation(({ ctx, input }) => {
    deleteDictation(ctx.db, input.id);
    return { ok: true };
  }),

  clearHistory: publicProcedure.mutation(({ ctx }) => {
    clearDictations(ctx.db);
    return { ok: true };
  }),

  /** Kept recordings (Settings > Dictation > Recordings): counts and sizes, never contents */
  recordings: publicProcedure.query(({ ctx }) =>
    recordingsSummary((id) => getProject(ctx.db, id)?.name ?? null),
  ),

  openRecordings: publicProcedure.mutation(async () => ({
    opened: (await shell.openPath(await ensureRecordingsDir())) === "",
  })),

  clearRecordings: publicProcedure.mutation(async () => {
    await clearRecordings();
    invalidateStorageReport();
    return { ok: true };
  }),

  copyHistory: publicProcedure.input(historyId).mutation(({ ctx, input }) => {
    const item = getDictation(ctx.db, input.id);
    if (item) clipboard.writeText(item.text);
    return { ok: !!item };
  }),
});

export function registerDictationIpc(): void {
  setDictationListening(dictationActive);
  ipcMain.on("dictation:audio", (_event, id: unknown, samples: unknown) =>
    dictationAudio(id, samples),
  );
  ipcMain.handle("dictation:mark-browser", (event, input) =>
    markDictationPage(event.sender, input ?? {}),
  );
  ipcMain.handle("dictation:insert-browser", (event, input) =>
    insertTextInBrowserPane(event.sender, input ?? {}),
  );
  // An IPC, not tRPC: the arm is bound to the window that pressed Test
  ipcMain.handle("dictation:test-mic", (event) => armMicTest(event.sender));
}
