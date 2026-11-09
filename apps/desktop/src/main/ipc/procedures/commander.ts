import { z } from "zod";
import {
  commanderAutonomy,
  commanderProjectId,
  ensureCommanderHome,
  setCommanderAutonomy,
} from "../../commander/home";
import { listAgents } from "../../db/queries/agents";
import { publicProcedure, router } from "../trpc";

export const commanderRouter = router({
  /** Its project once started, its newest session (live or ended, to resume) and how it answers */
  state: publicProcedure.query(({ ctx }) => {
    const projectId = commanderProjectId(ctx.db);
    const sessions = projectId
      ? listAgents(ctx.db, projectId).filter((a) => a.cliType !== "shell")
      : [];
    return { projectId, last: sessions[0] ?? null, autonomy: commanderAutonomy(ctx.db) };
  }),

  /** The folder with its brief and its project row, before a session starts in it */
  prepare: publicProcedure.mutation(async ({ ctx }) => {
    const project = await ensureCommanderHome(ctx.db);
    return { projectId: project.id };
  }),

  setAutonomy: publicProcedure
    .input(z.object({ autonomy: z.enum(["answer", "ask"]) }))
    .mutation(({ ctx, input }) => {
      setCommanderAutonomy(ctx.db, input.autonomy);
      return { autonomy: input.autonomy };
    }),
});
