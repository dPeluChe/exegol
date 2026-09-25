import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { coreRust } from "../../agents/spawn-env";
import { getProject, listProjects } from "../../db/queries";
import { isPathAllowed } from "../../security/path-guard";
import { detectRunTargets } from "../../system/scripts";
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

/** `root` came from the renderer unchecked: grep could read any folder on disk */
async function assertProjectRoot(
  root: string,
  ctx: { db: import("libsql").Database },
): Promise<void> {
  const bases = listProjects(ctx.db).map((p) => p.path);
  if (!(await isPathAllowed(root, bases))) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Search root is outside the registered projects",
    });
  }
}

export const fsSearchRouter = router({
  /** Filename fuzzy-finder backed by Rust `ignore` crate (gitignore-aware). */
  fuzzyFind: publicProcedure.input(fuzzyFindInput).query(async ({ ctx, input }) => {
    const rust = requireCoreRust();
    await assertProjectRoot(input.root, ctx);
    return rust.fsSearch(input.query, input.root, {
      maxResults: input.maxResults,
      maxDepth: input.maxDepth,
      includeHidden: input.includeHidden,
      respectGitignore: input.respectGitignore,
    });
  }),

  /** Regex content search backed by Rust `grep-regex` + `grep-searcher`. */
  grep: publicProcedure.input(grepInput).query(async ({ ctx, input }) => {
    const rust = requireCoreRust();
    await assertProjectRoot(input.root, ctx);
    return rust.fsGrep(input.pattern, input.root, {
      caseInsensitive: input.caseInsensitive,
      includeHidden: input.includeHidden,
      respectGitignore: input.respectGitignore,
      maxMatches: input.maxMatches,
      maxFileSizeKb: input.maxFileSizeKb,
      globs: input.globs,
    });
  }),

  /**
   * Search a whole project: the root and each subrepo/package (a workspace of
   * repos gitignores its children, so a root-only search found nothing).
   * Paths come back relative to the project; duplicates (a package the root
   * search also reached) are dropped.
   */
  projectSearch: publicProcedure
    .input(
      z.object({
        projectId: z.string(),
        /** The explorer's root when it is a folder inside the project (a launcher chip) */
        root: z.string().optional(),
        query: z.string().min(1).max(200),
        mode: z.enum(["name", "text"]),
        caseInsensitive: z.boolean().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const rust = requireCoreRust();
      const project = getProject(ctx.db, input.projectId);
      if (!project) return { mode: input.mode, names: [], hits: [] };
      if (input.root && !(await isPathAllowed(input.root, [project.path]))) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Search root is outside the project" });
      }
      const folders = await detectRunTargets(input.root ?? project.path);
      const prefix = (rel: string, p: string) => (rel ? `${rel}/${p}` : p);
      if (input.mode === "name") {
        const seen = new Set<string>();
        const names = folders
          .flatMap((f) =>
            rust
              .fsSearch(input.query, f.path, { maxResults: 100 })
              .map((r) => ({ ...r, relativePath: prefix(f.rel, r.relativePath) })),
          )
          .filter((r) => !r.isDir && !seen.has(r.path) && seen.add(r.path))
          .sort((a, b) => b.score - a.score)
          .slice(0, 100);
        return { mode: input.mode, names, hits: [] };
      }
      const seen = new Set<string>();
      const hits = folders
        .flatMap((f) =>
          rust
            .fsGrep(escapeRegex(input.query), f.path, {
              caseInsensitive: input.caseInsensitive ?? true,
              maxMatches: 300,
            })
            .map((h) => ({ ...h, relativePath: prefix(f.rel, h.relativePath) })),
        )
        .filter((h) => {
          const key = `${h.path}:${h.lineNumber}`;
          return !seen.has(key) && seen.add(key);
        })
        .slice(0, 500);
      return { mode: input.mode, names: [], hits };
    }),
});

/** The search box is plain text, not a regex: "a.b(" must not throw or over-match */
function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
