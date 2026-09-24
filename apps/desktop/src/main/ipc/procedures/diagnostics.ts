import { app, clipboard, shell } from "electron";
import { z } from "zod";
import { LOG_DIR } from "../../lib/logger";
import { collectDiagnostics, fileBugReport } from "../../system/diagnostics";
import { publicProcedure, router } from "../trpc";

/** T196: the title bar's bug button — redacted diagnostics, logs folder, GitHub issue. */
export const diagnosticsRouter = router({
  collect: publicProcedure.query(({ ctx }) => collectDiagnostics(ctx.db, app)),

  openLogs: publicProcedure.mutation(async () => {
    const error = await shell.openPath(LOG_DIR);
    return { opened: error === "" };
  }),

  /** Files exactly what the user reviewed in the dialog (collected once, when it opened). */
  report: publicProcedure
    .input(
      z.object({
        description: z.string().max(4000).default(""),
        text: z.string().max(200_000),
        lastError: z.string().nullable(),
      }),
    )
    .mutation(async ({ input }) => {
      const diag = { text: input.text, lastError: input.lastError, version: app.getVersion() };
      const result = await fileBugReport(diag, input.description);
      if (result.via === "browser") {
        // A URL carries a few KB: the full report rides the clipboard
        clipboard.writeText(diag.text);
        await shell.openExternal(result.url);
      }
      return result;
    }),
});
