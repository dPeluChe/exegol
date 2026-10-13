// agents router, parallel runs part (T65).
import type { AgentCliType } from "@exegol/shared";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { promoteParallelAgent } from "../../agents/agent-parallel-orchestration";
import { createAgent, getAgent, updateAgentStatus } from "../../db/queries";
import {
  createParallelRun,
  enrichParallelRunForComparison,
  getParallelRun,
  listParallelRuns,
  updateParallelRunStatus,
} from "../../db/queries/parallel-runs";
import { publicProcedure } from "../trpc";

export const agentParallelProcedures = {
  spawnParallel: publicProcedure
    .input(
      z.object({
        projectId: z.string().min(1),
        taskDescription: z.string().min(1),
        /** CLI types for each parallel variant (e.g. ["claude-code", "gemini", "codex"]) */
        cliTypes: z.array(z.string().min(1)).min(2).max(5),
        /** Use isolated worktrees for each variant */
        useWorktree: z.boolean().default(true),
        branchPrefix: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const manager = ctx.agentManager;
      const agentIds: string[] = [];
      const errors: string[] = [];

      // Spawn each variant in parallel
      const spawnPromises = input.cliTypes.map(async (cliType, index) => {
        const branchName = input.branchPrefix
          ? `${input.branchPrefix}-v${index + 1}`
          : `exegol/parallel-v${index + 1}`;
        const agent = createAgent(ctx.db, {
          projectId: input.projectId,
          cliType: cliType as AgentCliType,
          taskDescription: input.taskDescription,
        });
        agentIds.push(agent.id);
        try {
          await manager.spawn(ctx.db, agent, {
            projectId: input.projectId,
            cliType: cliType as AgentCliType,
            taskDescription: input.taskDescription,
            useWorktree: input.useWorktree,
            branchName,
          });
        } catch (err) {
          updateAgentStatus(ctx.db, agent.id, "failed", String(err));
          errors.push(`${cliType}: ${err instanceof Error ? err.message : String(err)}`);
        }
      });

      await Promise.all(spawnPromises);

      if (agentIds.length === 0) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `All parallel spawns failed: ${errors.join("; ")}`,
        });
      }

      // Create the parallel run record
      const run = createParallelRun(ctx.db, {
        projectId: input.projectId,
        taskDescription: input.taskDescription,
        cliTypes: input.cliTypes,
        agentIds,
      });

      // Link agents to the parallel run
      for (const agentId of agentIds) {
        ctx.db.prepare("UPDATE agents SET parallel_run_id = ? WHERE id = ?").run(run.id, agentId);
      }

      return { run, agentIds, errors };
    }),

  listParallelRuns: publicProcedure
    .input(z.object({ projectId: z.string() }))
    .query(({ ctx, input }) => {
      return listParallelRuns(ctx.db, input.projectId);
    }),

  getParallelRun: publicProcedure.input(z.object({ id: z.string() })).query(({ ctx, input }) => {
    return getParallelRun(ctx.db, input.id) ?? null;
  }),

  /** T107 — enriched comparator payload: single round-trip, server-side N work. */
  getParallelRunDetails: publicProcedure
    .input(z.object({ runId: z.string() }))
    .query(({ ctx, input }) => {
      const run = getParallelRun(ctx.db, input.runId);
      if (!run) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: `Parallel run ${input.runId} not found`,
        });
      }
      return enrichParallelRunForComparison(ctx.db, run);
    }),

  /** T131 — promote & clean is the default: losers' worktrees + branches are
   *  removed unless dirty (reported back, unset `clean` or pass `force` to
   *  override). The winner is never touched — defer mode. */
  promoteParallelAgent: publicProcedure
    .input(
      z.object({
        runId: z.string(),
        agentId: z.string(),
        clean: z.boolean().default(true),
        force: z.boolean().default(false),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const cleanup = await promoteParallelAgent(ctx.db, input.runId, input.agentId, {
        clean: input.clean,
        force: input.force,
      });
      return { success: true, cleanup };
    }),

  cancelParallelRun: publicProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const run = getParallelRun(ctx.db, input.id);
      if (!run) throw new TRPCError({ code: "NOT_FOUND" });
      const manager = ctx.agentManager;
      // Stop all running agents in the group: each stop is independent
      await Promise.all(
        run.agentIds
          .filter((agentId) => {
            const status = getAgent(ctx.db, agentId)?.status;
            return status === "running" || status === "spawning" || status === "waiting_input";
          })
          .map((agentId) => manager.stop(ctx.db, agentId)),
      );
      updateParallelRunStatus(ctx.db, input.id, "cancelled");
      return { success: true };
    }),
};
