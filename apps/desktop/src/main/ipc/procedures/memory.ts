import { z } from "zod";
import { extractAndStoreMemories } from "../../memory/extractor";
import {
  buildMemoryContext,
  createMemory,
  deleteMemory,
  getMemoriesForInjection,
  listMemories,
  MEMORY_CATEGORIES,
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
   * Search memories by keyword.
   */
  search: publicProcedure
    .input(z.object({ projectId: z.string(), query: z.string().min(1) }))
    .query(({ ctx, input }) => {
      return searchMemories(ctx.db, input.projectId, input.query);
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
      return createMemory(ctx.db, input);
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
