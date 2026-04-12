/**
 * T100: tRPC procedures for project indexing + Ollama status.
 */

import { z } from "zod";
import { DEFAULT_EXCLUDE_PATTERNS } from "../../indexer/chunker";
import { checkOllamaStatus, type OllamaConfig } from "../../indexer/ollama-client";
import { indexProject } from "../../indexer/project-indexer";
import { semanticSearch } from "../../indexer/search";
import { logger } from "../../lib/logger";
import { publicProcedure, router } from "../trpc";

export const indexerRouter = router({
  /** Check if Ollama is running and the embedding model is available */
  ollamaStatus: publicProcedure
    .input(
      z
        .object({
          url: z.string().optional(),
          model: z.string().optional(),
        })
        .optional(),
    )
    .query(async ({ input }) => {
      const config: OllamaConfig = {
        url: input?.url ?? "http://localhost:11434",
        model: input?.model ?? "nomic-embed-text",
      };
      return checkOllamaStatus(config);
    }),

  /** Get indexing stats for a project */
  projectStats: publicProcedure
    .input(z.object({ projectId: z.string() }))
    .query(({ ctx, input }) => {
      const fileCount =
        (
          ctx.db
            .prepare("SELECT COUNT(*) as count FROM file_index WHERE project_id = ?")
            .get(input.projectId) as { count: number } | undefined
        )?.count ?? 0;

      const chunkCount =
        (
          ctx.db
            .prepare(
              `SELECT COUNT(*) as count FROM file_chunks fc
               JOIN file_index fi ON fc.file_id = fi.id
               WHERE fi.project_id = ?`,
            )
            .get(input.projectId) as { count: number } | undefined
        )?.count ?? 0;

      const lastIndexed =
        (
          ctx.db
            .prepare("SELECT MAX(indexed_at) as ts FROM file_index WHERE project_id = ?")
            .get(input.projectId) as { ts: number | null } | undefined
        )?.ts ?? null;

      return { fileCount, chunkCount, lastIndexed };
    }),

  /** Start indexing a project (runs in background, returns immediately) */
  startIndexing: publicProcedure
    .input(
      z.object({
        projectId: z.string(),
        ollamaUrl: z.string().default("http://localhost:11434"),
        ollamaModel: z.string().default("nomic-embed-text"),
        excludePatterns: z.array(z.string()).default(DEFAULT_EXCLUDE_PATTERNS),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const project = ctx.db
        .prepare("SELECT path FROM projects WHERE id = ?")
        .get(input.projectId) as { path: string } | undefined;

      if (!project) {
        return { success: false, error: "Project not found" };
      }

      const config: OllamaConfig = {
        url: input.ollamaUrl,
        model: input.ollamaModel,
      };

      // Check Ollama first
      const status = await checkOllamaStatus(config);
      if (!status.available || !status.modelInstalled) {
        return {
          success: false,
          error: status.error ?? "Ollama not available",
        };
      }

      // Run indexing in background (don't await — it can take minutes)
      logger.info(`[Indexer] Starting indexing for project ${input.projectId}`);
      indexProject(ctx.db, input.projectId, project.path, config, input.excludePatterns).catch(
        (err) => {
          logger.error(`[Indexer] Background indexing failed:`, err);
        },
      );

      return { success: true };
    }),

  /** T68: Semantic search over the project's indexed codebase */
  search: publicProcedure
    .input(
      z.object({
        projectId: z.string(),
        query: z.string().min(1),
        topK: z.number().int().min(1).max(20).default(5),
        ollamaUrl: z.string().default("http://localhost:11434"),
        ollamaModel: z.string().default("nomic-embed-text"),
      }),
    )
    .query(async ({ ctx, input }) => {
      const config: OllamaConfig = {
        url: input.ollamaUrl,
        model: input.ollamaModel,
      };
      return semanticSearch(ctx.db, input.projectId, input.query, config, input.topK);
    }),
});
