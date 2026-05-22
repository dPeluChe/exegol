import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { publicProcedure } from "../trpc";
import { detectGhCli, execFileAsync, resolveProjectPath } from "./diff-helpers";

export const prProcedures = {
  /** Create a GitHub PR via gh CLI. Falls back to error if gh not installed. */
  createPullRequest: publicProcedure
    .input(
      z.object({
        projectId: z.string(),
        pathOverride: z.string().optional(),
        title: z.string().optional(),
        body: z.string().optional(),
        draft: z.boolean().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const cwd = input.pathOverride || resolveProjectPath(ctx.db, input.projectId);
      if (!(await detectGhCli())) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "GitHub CLI (gh) is not installed. Install it from https://cli.github.com/",
        });
      }
      const args = ["pr", "create"];
      if (input.title) {
        args.push("--title", input.title);
        args.push("--body", input.body ?? "");
      } else {
        args.push("--fill"); // use commit messages
      }
      if (input.draft) args.push("--draft");
      try {
        const { stdout } = await execFileAsync("gh", args, { cwd, timeout: 30_000 });
        return { url: stdout.trim() };
      } catch (err) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `gh pr create failed: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
    }),

  /** Merge an open PR via gh CLI */
  mergePullRequest: publicProcedure
    .input(
      z.object({
        projectId: z.string(),
        pathOverride: z.string().optional(),
        strategy: z.enum(["merge", "squash", "rebase"]).default("squash"),
        deleteBranch: z.boolean().default(true),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const cwd = input.pathOverride || resolveProjectPath(ctx.db, input.projectId);
      if (!(await detectGhCli())) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "GitHub CLI (gh) is not installed.",
        });
      }
      const args = ["pr", "merge", `--${input.strategy}`];
      if (input.deleteBranch) args.push("--delete-branch");
      try {
        const { stdout } = await execFileAsync("gh", args, { cwd, timeout: 60_000 });
        return { output: stdout.trim() || "Merged successfully" };
      } catch (err) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `gh pr merge failed: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
    }),
};
