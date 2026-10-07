import { DICTATION_TARGET_KINDS } from "@exegol/shared";
import { clipboard, ipcMain } from "electron";
import { z } from "zod";
import { insertTextInBrowserPane } from "../../browser/electron-host";
import {
  clearDictations,
  deleteDictation,
  getDictation,
  listDictations,
} from "../../dictation/history";
import { setDictationListening } from "../../dictation/keys";
import { askMic, openMicSettings } from "../../dictation/mic";
import {
  cancelDictation,
  dictationActive,
  dictationAudio,
  dictationStatus,
  startDictation,
  stopDictation,
} from "../../dictation/service";
import { getMainWindow } from "../../windows/main-window-ref";
import { publicProcedure, router } from "../trpc";

const sessionId = z.string().regex(/^[A-Za-z0-9_-]{8,32}$/);
const historyId = z.object({ id: z.string().regex(/^[A-Za-z0-9_-]{1,32}$/) });

/** Local voice dictation (T201): mic permission, sessions, history (Settings > Dictation) */
export const dictationRouter = router({
  status: publicProcedure.query(({ ctx }) => dictationStatus(ctx.db)),

  requestMic: publicProcedure.mutation(async () => ({ mic: await askMic() })),

  openMicSettings: publicProcedure.mutation(() => {
    openMicSettings();
    return { ok: true };
  }),

  /** Audio then arrives on `dictation:audio`; partial text on `dictation:partial` */
  start: publicProcedure.mutation(({ ctx }) => startDictation(ctx.db)),

  stop: publicProcedure
    .input(
      z.object({
        sessionId,
        durationMs: z.number().min(0).max(3_600_000),
        projectId: z.string().max(64).nullable(),
        targetKind: z.enum(DICTATION_TARGET_KINDS),
      }),
    )
    .mutation(({ ctx, input }) => stopDictation(ctx.db, input)),

  cancel: publicProcedure.input(z.object({ sessionId })).mutation(({ input }) => {
    cancelDictation(input.sessionId);
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

  copyHistory: publicProcedure.input(historyId).mutation(({ ctx, input }) => {
    const item = getDictation(ctx.db, input.id);
    if (item) clipboard.writeText(item.text);
    return { ok: !!item };
  }),

  /** From the Settings window: the main window types it into its own focused pane */
  insertHistory: publicProcedure.input(historyId).mutation(({ ctx, input }) => {
    const item = getDictation(ctx.db, input.id);
    const win = getMainWindow();
    if (!item || !win || win.isDestroyed()) return { ok: false };
    win.webContents.send("dictation:insert", { text: item.text });
    return { ok: true };
  }),
});

export function registerDictationIpc(): void {
  setDictationListening(dictationActive);
  ipcMain.on("dictation:audio", (_event, id: unknown, samples: unknown) =>
    dictationAudio(id, samples),
  );
  ipcMain.handle("dictation:insert-browser", (event, input) =>
    insertTextInBrowserPane(event.sender, input ?? {}),
  );
}
