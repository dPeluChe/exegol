import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { callAnthropicMessage } from "../../lib/anthropic";
import { truncateDiffForPrompt } from "../../lib/diff-budget";
import { logger } from "../../lib/logger";
import { getApiKey } from "../../security/keystore";
import { publicProcedure } from "../trpc";
import { resolveProjectPath, runGitDiff } from "./diff-helpers";

export const aiProcedures = {
  /** Suggest a commit message by asking Claude Haiku to summarize the diff */
  suggestCommitMessage: publicProcedure
    .input(
      z.object({
        projectId: z.string(),
        pathOverride: z.string().optional(),
        staged: z.boolean().default(false),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const cwd = input.pathOverride || resolveProjectPath(ctx.db, input.projectId);
      const apiKey = getApiKey(ctx.db, "anthropic");
      if (!apiKey) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Anthropic API key not configured. Set it in Settings → API Keys.",
        });
      }
      // Grab the diff (prefer staged if anything is staged; else worktree)
      const diff = await runGitDiff(cwd, input.staged ? ["--cached"] : []);
      if (!diff.trim()) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "No changes to summarize.",
        });
      }
      // Budgeted per file, not head-truncated: a regenerated lockfile must not
      // push the hand-written change out of the prompt.
      const truncated = truncateDiffForPrompt(diff);

      const prompt = `You are writing a conventional-commit-style git commit message.

Here is the diff:

${truncated}

Respond with ONLY the commit message — one line, imperative mood, max 72 chars.
Use a conventional prefix (feat/fix/chore/docs/refactor/perf/test/style) when obvious.
No explanation, no quotes, no markdown.`;

      try {
        // maxRetries 2: this backs an interactive button — cap worst-case latency
        const { text } = await callAnthropicMessage({
          apiKey,
          model: "claude-haiku-4-5-20251001",
          maxTokens: 120,
          prompt,
          timeoutMs: 20_000,
          label: "diff.suggestCommitMessage",
          maxRetries: 2,
        });
        // First line only, strip quotes/backticks
        const message = text.split("\n")[0]?.replace(/^[`"'\s]+|[`"'\s]+$/g, "") ?? "";
        if (!message) {
          throw new Error("Empty response from Anthropic");
        }
        return { message };
      } catch (err) {
        logger.warn("[suggestCommitMessage] failed:", err);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Failed to generate suggestion: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
    }),
};
