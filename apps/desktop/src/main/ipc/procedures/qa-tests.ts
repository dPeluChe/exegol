import type { QaTestStatus } from "@exegol/shared";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  createQaTest,
  createQaTestRun,
  deleteQaTest,
  getLatestTestRun,
  getQaTest,
  listQaTests,
  updateQaTestLastRun,
} from "../../db/queries/qa-tests";
import { publicProcedure, router } from "../trpc";

export const qaTestRouter = router({
  list: publicProcedure.input(z.object({ projectId: z.string() })).query(({ ctx, input }) => {
    return listQaTests(ctx.db, input.projectId);
  }),

  get: publicProcedure.input(z.object({ id: z.string() })).query(({ ctx, input }) => {
    const test = getQaTest(ctx.db, input.id);
    if (!test) throw new TRPCError({ code: "NOT_FOUND", message: "QA test not found" });
    return test;
  }),

  save: publicProcedure
    .input(
      z.object({
        projectId: z.string(),
        name: z.string().min(1),
        startUrl: z.string(),
        actions: z.string(),
      }),
    )
    .mutation(({ ctx, input }) => {
      return createQaTest(ctx.db, input);
    }),

  delete: publicProcedure.input(z.object({ id: z.string() })).mutation(({ ctx, input }) => {
    deleteQaTest(ctx.db, input.id);
    return { success: true };
  }),

  getLatestRun: publicProcedure.input(z.object({ testId: z.string() })).query(({ ctx, input }) => {
    return getLatestTestRun(ctx.db, input.testId);
  }),

  saveRun: publicProcedure
    .input(
      z.object({
        testId: z.string(),
        passed: z.boolean(),
        stepResults: z.string(),
        consoleErrors: z.string(),
        durationMs: z.number(),
      }),
    )
    .mutation(({ ctx, input }) => {
      const status: QaTestStatus = input.passed ? "passed" : "failed";
      const run = createQaTestRun(ctx.db, {
        testId: input.testId,
        status,
        stepResults: input.stepResults,
        consoleErrors: input.consoleErrors,
        durationMs: input.durationMs,
      });
      updateQaTestLastRun(ctx.db, input.testId, status);
      return run;
    }),
});
