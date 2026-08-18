import { z } from "zod";
import { getProject, listWorktrees } from "../../db/queries";
import {
  getAgentFinalOutput,
  listHistoryCliTypes,
  listSessionHistory,
} from "../../db/queries/agents";
import { listLocalSessions } from "../../history";
import { mergeHistory } from "../../history/merge";
import { publicProcedure, router } from "../trpc";

/** The base view is the last 30 days; older sessions stay for reference behind
 *  the range filter (Antonio, 2026-08-18: "el historico si exista para
 *  referencia unicamente"). */
const DEFAULT_WINDOW_DAYS = 30;

export const historyRouter = router({
  /**
   * T181: what has been done on this repo — Exegol's own sessions plus whatever
   * the installed CLIs recorded for the same directories. An isolated agent's
   * cwd is its worktree, not the project path, so every worktree counts as this
   * repo too.
   */
  list: publicProcedure
    .input(
      z.object({
        projectId: z.string(),
        cliType: z.string().optional(),
        /** 0 = everything ever recorded. */
        days: z.number().int().min(0).max(3650).optional(),
        limit: z.number().int().min(1).max(500).optional(),
        offset: z.number().int().min(0).optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const project = getProject(ctx.db, input.projectId);
      if (!project) return { entries: [], providers: [] };

      const days = input.days ?? DEFAULT_WINDOW_DAYS;
      const since = days === 0 ? 0 : Math.floor(Date.now() / 1000) - days * 86_400;

      const rows = listSessionHistory(ctx.db, {
        projectId: input.projectId,
        cliType: input.cliType,
        since,
        limit: input.limit ?? 100,
        offset: input.offset,
      });

      const cwds = [project.path, ...listWorktrees(ctx.db, input.projectId).map((w) => w.path)];
      const local = await listLocalSessions(cwds, since);
      const filtered = input.cliType ? local.filter((s) => s.provider === input.cliType) : local;

      return {
        entries: mergeHistory(rows, filtered),
        // The filter offers what this repo has actually been worked with, from
        // both sources — not the full provider registry.
        providers: [
          ...new Set([
            ...listHistoryCliTypes(ctx.db, input.projectId),
            ...local.map((s) => s.provider),
          ]),
        ].sort(),
      };
    }),

  /** The tail of what a past Exegol session said. Local sessions have none —
   *  their transcripts belong to the CLI and are not ours to reformat. */
  finalOutput: publicProcedure
    .input(z.object({ agentId: z.string() }))
    .query(({ ctx, input }) => ({ output: getAgentFinalOutput(ctx.db, input.agentId) })),
});
