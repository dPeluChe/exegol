import { z } from "zod";
import { getProject } from "../../db/queries/projects";
import { viewServers } from "../../views/discover";
import {
  clearViews,
  copyViewImage,
  recaptureView,
  resumeViews,
  startViews,
  stopViews,
  viewFile,
  viewsState,
  viewThumb,
} from "../../views/pass";
import { publicProcedure, router } from "../trpc";

const project = z.object({ projectId: z.string() });
const view = project.extend({ path: z.string().max(2_000) });

export const viewsRouter = router({
  servers: publicProcedure.input(project).query(async ({ ctx, input }) => {
    const found = getProject(ctx.db, input.projectId);
    return found ? (await viewServers(found.path)).map((s) => s.port) : [];
  }),
  state: publicProcedure.input(project).query(({ input }) => viewsState(input.projectId)),
  start: publicProcedure
    .input(
      project.extend({
        /** Absent: the port a new browser pane of the project would open */
        port: z.number().int().min(1).max(65_535).optional(),
        /** Only when no pass ran yet: what opening the pane asks for */
        ifEmpty: z.boolean().optional(),
      }),
    )
    .mutation(({ ctx, input: { projectId, ...opts } }) => {
      void startViews(ctx.db, projectId, opts);
    }),
  resume: publicProcedure
    .input(project.extend({ retry: z.boolean() }))
    .mutation(({ input }) => resumeViews(input.projectId, input.retry)),
  stop: publicProcedure.input(project).mutation(({ input }) => stopViews(input.projectId)),
  clear: publicProcedure.input(project).mutation(({ input }) => clearViews(input.projectId)),
  thumb: publicProcedure
    .input(view.extend({ full: z.boolean().optional() }))
    .query(({ input }) => viewThumb(input.projectId, input.path, input.full)),
  recapture: publicProcedure.input(view).mutation(({ input }) => {
    void recaptureView(input.projectId, input.path);
  }),
  file: publicProcedure.input(view).query(({ input }) => viewFile(input.projectId, input.path)),
  copyImage: publicProcedure
    .input(view)
    .mutation(({ input }) => copyViewImage(input.projectId, input.path)),
});
