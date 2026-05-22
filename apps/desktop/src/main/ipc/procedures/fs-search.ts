import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { coreRust } from "../../agents/spawn-env";
import { publicProcedure, router } from "../trpc";

const fuzzyFindInput = z.object({
  query: z.string(),
  root: z.string().min(1),
  maxResults: z.number().int().min(1).max(500).optional(),
  maxDepth: z.number().int().min(1).max(32).optional(),
  includeHidden: z.boolean().optional(),
  respectGitignore: z.boolean().optional(),
});

const grepInput = z.object({
  pattern: z.string().min(1),
  root: z.string().min(1),
  caseInsensitive: z.boolean().optional(),
  includeHidden: z.boolean().optional(),
  respectGitignore: z.boolean().optional(),
  maxMatches: z.number().int().min(1).max(5000).optional(),
  maxFileSizeKb: z.number().int().min(1).max(10240).optional(),
  globs: z.array(z.string().min(1)).optional(),
});

function requireCoreRust(): NonNullable<typeof coreRust> {
  if (!coreRust) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Rust native module not available for filesystem search",
    });
  }
  return coreRust;
}

export const fsSearchRouter = router({
  /** Filename fuzzy-finder backed by Rust `ignore` crate (gitignore-aware). */
  fuzzyFind: publicProcedure.input(fuzzyFindInput).query(({ input }) => {
    const rust = requireCoreRust();
    return rust.fsSearch(input.query, input.root, {
      maxResults: input.maxResults,
      maxDepth: input.maxDepth,
      includeHidden: input.includeHidden,
      respectGitignore: input.respectGitignore,
    });
  }),

  /** Regex content search backed by Rust `grep-regex` + `grep-searcher`. */
  grep: publicProcedure.input(grepInput).query(({ input }) => {
    const rust = requireCoreRust();
    return rust.fsGrep(input.pattern, input.root, {
      caseInsensitive: input.caseInsensitive,
      includeHidden: input.includeHidden,
      respectGitignore: input.respectGitignore,
      maxMatches: input.maxMatches,
      maxFileSizeKb: input.maxFileSizeKb,
      globs: input.globs,
    });
  }),
});
