import { browserPartitionFor } from "@exegol/shared";
import { app, session, shell } from "electron";
import { z } from "zod";
import { listProjects } from "../../db/queries/projects";
import { LOG_DIR } from "../../lib/logger";
import {
  categorySpecs,
  clearOldLogs,
  clearScreenshots,
  getStorageReport,
  invalidateStorageReport,
  type StoragePaths,
} from "../../system/storage";
import { EXEGOL_DIR } from "../../terminal/pty-sidecar-protocol";
import { publicProcedure, router } from "../trpc";

const storagePaths = (): StoragePaths => ({
  exegolDir: EXEGOL_DIR,
  userData: app.getPath("userData"),
  logDir: LOG_DIR,
});

const CATEGORIES = [
  "models",
  "scrollback",
  "screenshots",
  "logs",
  "database",
  "worktrees",
  "browser",
  "other",
] as const;

/** Exegol's disk use (Settings > Storage). Folders are chosen here by category, never by a renderer path */
export const storageRouter = router({
  report: publicProcedure
    .input(z.object({ fresh: z.boolean().default(false) }).default({}))
    .query(({ ctx, input }) => getStorageReport(storagePaths(), listProjects(ctx.db), input.fresh)),

  openFolder: publicProcedure
    .input(z.object({ category: z.enum(CATEGORIES) }))
    .mutation(async ({ input }) => {
      const paths = storagePaths();
      const spec = categorySpecs(paths).find((s) => s.category === input.category);
      const folder =
        input.category === "database" || input.category === "browser"
          ? paths.userData
          : input.category === "other"
            ? paths.exegolDir
            : (spec?.paths[0] ?? paths.exegolDir);
      const error = await shell.openPath(folder);
      return { opened: error === "" };
    }),

  clearScreenshots: publicProcedure.mutation(async () => {
    await clearScreenshots(EXEGOL_DIR);
    invalidateStorageReport();
    return { ok: true };
  }),

  clearOldLogs: publicProcedure.mutation(async () => {
    const removed = await clearOldLogs(LOG_DIR);
    invalidateStorageReport();
    return { removed };
  }),

  /** HTTP and code caches only: cookies and site storage (logins) stay */
  clearBrowserCache: publicProcedure
    .input(z.object({ projectId: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/) }))
    .mutation(async ({ ctx, input }) => {
      if (!listProjects(ctx.db).some((p) => p.id === input.projectId)) {
        throw new Error("unknown project");
      }
      const ses = session.fromPartition(browserPartitionFor(input.projectId));
      await ses.clearCache();
      await ses.clearCodeCaches({});
      invalidateStorageReport();
      return { ok: true };
    }),
});
