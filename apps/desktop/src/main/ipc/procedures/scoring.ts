import { z } from "zod";
import { getAgentScore, getProjectScoringStats, listProjectScores } from "../../agents/scoring";
import { publicProcedure, router } from "../trpc";

export const scoringRouter = router({
  /** Get score for a single agent */
  getScore: publicProcedure.input(z.object({ agentId: z.string() })).query(({ ctx, input }) => {
    return getAgentScore(ctx.db, input.agentId);
  }),

  /** List all scores for a project */
  listScores: publicProcedure.input(z.object({ projectId: z.string() })).query(({ ctx, input }) => {
    return listProjectScores(ctx.db, input.projectId);
  }),

  /** Get aggregate scoring stats for a project */
  stats: publicProcedure.input(z.object({ projectId: z.string() })).query(({ ctx, input }) => {
    return getProjectScoringStats(ctx.db, input.projectId);
  }),
});
