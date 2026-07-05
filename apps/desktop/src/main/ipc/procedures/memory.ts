import { DEFAULT_SETTINGS } from "@exegol/shared";
import { z } from "zod";
import type { OllamaConfig } from "../../indexer/ollama-client";
import { extractAndStoreMemories } from "../../memory/extractor";
import {
  buildMemoryContext,
  deleteMemory,
  getMemoriesForInjection,
  getMemoryById,
  listMemories,
  MEMORY_CATEGORIES,
  observeMemory,
  searchMemories,
  updateMemoryRelevance,
} from "../../memory/store";
import { publicProcedure, router } from "../trpc";

const memoryCategoryEnum = z.enum(MEMORY_CATEGORIES);

export const memoryRouter = router({
  /**
   * List all memories for a project.
   */
  list: publicProcedure
    .input(
      z.object({
        projectId: z.string(),
        category: memoryCategoryEnum.optional(),
      }),
    )
    .query(({ ctx, input }) => {
      const all = listMemories(ctx.db, input.projectId);
      if (input.category) {
        return all.filter((m) => m.category === input.category);
      }
      return all;
    }),

  /**
   * Hybrid RRF search over memories (T125): FTS5 keyword + optional Ollama vector pass.
   */
  search: publicProcedure
    .input(
      z.object({
        projectId: z.string(),
        query: z.string().min(1),
        ollamaUrl: z.string().optional(),
        ollamaModel: z.string().optional(),
      }),
    )
    .query(({ ctx, input }) => {
      const ollamaConfig: OllamaConfig = {
        url: input.ollamaUrl ?? DEFAULT_SETTINGS.ollamaUrl,
        model: input.ollamaModel ?? DEFAULT_SETTINGS.ollamaModel,
      };
      return searchMemories(ctx.db, input.projectId, input.query, ollamaConfig);
    }),

  /**
   * Create a new memory entry manually.
   */
  create: publicProcedure
    .input(
      z.object({
        projectId: z.string(),
        category: memoryCategoryEnum,
        content: z.string().min(1),
        sourceAgentId: z.string().optional(),
        relevanceScore: z.number().min(0).max(1).optional(),
      }),
    )
    .mutation(({ ctx, input }) => {
      // T126: manual adds go through the same reinforce/supersede/create
      // classification as extractor observations — no duplicate active rows.
      const id = observeMemory(ctx.db, input);
      return getMemoryById(ctx.db, id);
    }),

  /**
   * Delete a memory entry.
   */
  delete: publicProcedure.input(z.object({ id: z.string() })).mutation(({ ctx, input }) => {
    deleteMemory(ctx.db, input.id);
    return { success: true };
  }),

  /**
   * Update a memory's relevance score.
   */
  updateRelevance: publicProcedure
    .input(z.object({ id: z.string(), relevanceScore: z.number().min(0).max(1) }))
    .mutation(({ ctx, input }) => {
      updateMemoryRelevance(ctx.db, input.id, input.relevanceScore);
      return { success: true };
    }),

  /**
   * Get memory context string for agent injection.
   */
  getContext: publicProcedure
    .input(z.object({ projectId: z.string(), maxCount: z.number().optional() }))
    .query(({ ctx, input }) => {
      const memories = getMemoriesForInjection(ctx.db, input.projectId, input.maxCount);
      return {
        context: buildMemoryContext(memories),
        count: memories.length,
      };
    }),

  /**
   * Extract memories from an agent's scrollback.
   */
  extract: publicProcedure
    .input(
      z.object({
        agentId: z.string(),
        projectId: z.string(),
        scrollback: z.string(),
      }),
    )
    .mutation(({ ctx, input }) => {
      const count = extractAndStoreMemories(
        ctx.db,
        input.agentId,
        input.projectId,
        input.scrollback,
      );
      return { extracted: count };
    }),
});
