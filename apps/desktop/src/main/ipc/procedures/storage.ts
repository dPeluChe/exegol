import { browserPartitionFor, STORAGE_CATEGORIES, STORAGE_ROOTS } from "@exegol/shared";
import { app, session, shell } from "electron";
import { z } from "zod";
import { listProjects } from "../../db/queries/projects";
import { listAllWorktreeRows } from "../../db/queries/worktrees";
import { LOG_DIR } from "../../lib/logger";
import {
  cachedStorageReport,
  clearOldLogs,
  clearScreenshots,
  getStorageReport,
  invalidateStorageReport,
  resolveOtherTarget,
  type StoragePaths,
  worktreeSizes,
} from "../../system/storage";
import { EXEGOL_DIR } from "../../terminal/pty-sidecar-protocol";
import { publicProcedure, router } from "../trpc";

const storagePaths = (): StoragePaths => ({
  exegolDir: EXEGOL_DIR,
  userData: app.getPath("userData"),
  logDir: LOG_DIR,
});

/** Exegol's disk use (Settings > Storage). Folders are chosen here by category, never by a renderer path */
export const storageRouter = router({
  report: publicProcedure
    .input(z.object({ fresh: z.boolean().default(false) }).default({}))
    .query(({ ctx, input }) => getStorageReport(storagePaths(), listProjects(ctx.db), input.fresh)),

  openFolder: publicProcedure
    .input(z.object({ category: z.enum(STORAGE_CATEGORIES) }))
    .mutation(async ({ ctx, input }) => {
      const report = await getStorageReport(storagePaths(), listProjects(ctx.db));
      const folder = report.rows.find((r) => r.category === input.category)?.path;
      if (!folder) return { opened: false };
      return { opened: (await shell.openPath(folder)) === "" };
    }),

  /** Only a name the cached report lists under Other: the renderer never picks a path */
  openOther: publicProcedure
    .input(z.object({ root: z.enum(STORAGE_ROOTS), name: z.string().min(1).max(255) }))
    .mutation(async ({ input }) => {
      const resolved = await resolveOtherTarget(
        storagePaths(),
        cachedStorageReport(),
        input.root,
        input.name,
      );
      if (!resolved.ok) return { opened: false, reason: resolved.reason };
      if (!resolved.isDir) {
        shell.showItemInFolder(resolved.target);
        return { opened: true };
      }
      const error = await shell.openPath(resolved.target);
      return error ? { opened: false, reason: error } : { opened: true };
    }),

  worktreeSizes: publicProcedure.query(({ ctx }) => worktreeSizes(listAllWorktreeRows(ctx.db))),

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
