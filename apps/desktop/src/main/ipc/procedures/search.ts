import { DEFAULT_SETTINGS } from "@exegol/shared";
import { existsSync, readFileSync } from "node:fs";
import { z } from "zod";
import { hybridSearch, indexScrollback, rebuildIndex } from "../../db/queries/search";
import type { OllamaConfig } from "../../indexer/ollama-client";
import { publicProcedure, router } from "../trpc";
import { getScrollbackPath } from "./scrollback";

export const searchRouter = router({
  /** Hybrid (FTS5 + Ollama-vector) search across indexed content (T125). */
  query: publicProcedure
    .input(
      z.object({
        query: z.string().min(1).max(500),
        projectId: z.string().optional(),
        limit: z.number().min(1).max(200).optional(),
        ollamaUrl: z.string().optional(),
        ollamaModel: z.string().optional(),
      }),
    )
    .query(({ input, ctx }) => {
      const ollamaConfig: OllamaConfig = {
        url: input.ollamaUrl ?? DEFAULT_SETTINGS.ollamaUrl,
        model: input.ollamaModel ?? DEFAULT_SETTINGS.ollamaModel,
      };
      return hybridSearch(ctx.db, input.query, {
        projectId: input.projectId,
        limit: input.limit,
        ollamaConfig,
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
