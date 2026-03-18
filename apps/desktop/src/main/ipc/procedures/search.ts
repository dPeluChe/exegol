import { existsSync, readFileSync } from "node:fs";
import { z } from "zod";
import { indexScrollback, rebuildIndex, search } from "../../db/queries/search";
import { publicProcedure, router } from "../trpc";
import { getScrollbackPath } from "./scrollback";

export const searchRouter = router({
  /** Full-text search across indexed content. */
  query: publicProcedure
    .input(
      z.object({
        query: z.string().min(1).max(500),
        projectId: z.string().optional(),
        limit: z.number().min(1).max(200).optional(),
      }),
    )
    .query(({ input, ctx }) => {
      return search(ctx.db, input.query, {
        projectId: input.projectId,
        limit: input.limit,
      });
    }),

  /** Index a specific agent's scrollback into the FTS5 index. */
  indexAgent: publicProcedure
    .input(z.object({ agentId: z.string(), projectId: z.string(), taskDescription: z.string() }))
    .mutation(({ input, ctx }) => {
      // Read scrollback file
      let content: string;
      try {
        const filePath = getScrollbackPath(input.agentId);
        if (!existsSync(filePath)) {
          return { indexed: 0 };
        }
        content = readFileSync(filePath, "utf-8");
      } catch {
        return { indexed: 0 };
      }

      // Strip ANSI escape codes for cleaner FTS indexing
      const cleanContent = content.replace(
        // biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI escape sequence stripping
        /\x1B(?:[@-Z\\-_]|\[[0-9;]*[A-Za-z]|\][^\x07]*\x07)/g,
        "",
      );

      const count = indexScrollback(
        ctx.db,
        input.agentId,
        input.projectId,
        input.taskDescription,
        cleanContent,
      );
      return { indexed: count };
    }),

  /** Rebuild the entire search index from current DB state. */
  rebuild: publicProcedure.mutation(({ ctx }) => {
    return rebuildIndex(ctx.db);
  }),
});
