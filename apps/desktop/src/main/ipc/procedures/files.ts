import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { TRPCError } from "@trpc/server";
import { BrowserWindow, dialog } from "electron";
import { z } from "zod";
import { listProjects } from "../../db/queries";
import { publicProcedure, router } from "../trpc";

const EXTENSION_LANGUAGES: Record<string, string> = {
  ".ts": "typescript",
  ".tsx": "typescript",
  ".js": "javascript",
  ".jsx": "javascript",
  ".rs": "rust",
  ".py": "python",
  ".go": "go",
  ".md": "markdown",
  ".json": "json",
  ".toml": "toml",
  ".yaml": "yaml",
  ".yml": "yaml",
  ".html": "html",
  ".css": "css",
  ".sql": "sql",
  ".sh": "shell",
  ".zsh": "shell",
  ".bash": "shell",
};

const IGNORED_NAMES = new Set([
  "node_modules",
  "dist",
  ".git",
  "target",
  ".next",
  ".turbo",
  ".cache",
  "coverage",
  "__pycache__",
  ".DS_Store",
  "Thumbs.db",
]);

/**
 * Validate that a path is inside one of the registered project directories.
 * Resolves symlinks and normalizes before comparison to prevent traversal attacks.
 */
function assertPathInsideProject(filePath: string, ctx: { db: import("libsql").Database }): void {
  const normalized = resolve(filePath);
  const projects = listProjects(ctx.db);
  // Allow project directories + worktree directories (~/.exegol/worktrees/ and ~/.exegol/pipelines/)
  const exegolDir = resolve(require("node:os").homedir(), ".exegol");
  const isAllowed =
    projects.some((p) => normalized.startsWith(resolve(p.path))) ||
    normalized.startsWith(exegolDir);
  if (!isAllowed) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Access denied: path is outside any registered project directory",
    });
  }
}

export interface DirectoryEntry {
  name: string;
  path: string;
  isDirectory: boolean;
  size: number;
  modified: number;
}

export const filesRouter = router({
  exists: publicProcedure.input(z.object({ path: z.string() })).query(({ ctx, input }) => {
    assertPathInsideProject(input.path, ctx);
    return { exists: existsSync(input.path) };
  }),

  readFile: publicProcedure.input(z.object({ path: z.string() })).query(({ ctx, input }) => {
    assertPathInsideProject(input.path, ctx);
    if (!existsSync(input.path)) {
      throw new TRPCError({ code: "NOT_FOUND", message: `File not found: ${input.path}` });
    }
    const content = readFileSync(input.path, "utf-8");
    const ext = extname(input.path);
    const language = EXTENSION_LANGUAGES[ext] ?? "plaintext";
    return { content, language };
  }),

  writeFile: publicProcedure
    .input(z.object({ path: z.string(), content: z.string() }))
    .mutation(({ ctx, input }) => {
      assertPathInsideProject(input.path, ctx);
      writeFileSync(input.path, input.content, "utf-8");
      return { success: true };
    }),

  pickFile: publicProcedure
    .input(
      z.object({
        projectPath: z.string(),
        filters: z
          .array(z.object({ name: z.string(), extensions: z.array(z.string()) }))
          .optional(),
      }),
    )
    .mutation(async ({ input }) => {
      const win = BrowserWindow.getFocusedWindow();
      if (!win) return null;

      const result = await dialog.showOpenDialog(win, {
        defaultPath: input.projectPath,
        filters: input.filters ?? [{ name: "Markdown", extensions: ["md"] }],
        properties: ["openFile"],
      });

      if (result.canceled || result.filePaths.length === 0) return null;
      return result.filePaths[0];
    }),

  listDirectory: publicProcedure.input(z.object({ path: z.string() })).query(({ ctx, input }) => {
    assertPathInsideProject(input.path, ctx);
    if (!existsSync(input.path)) {
      throw new TRPCError({ code: "NOT_FOUND", message: `Directory not found: ${input.path}` });
    }

    const entries: DirectoryEntry[] = [];
    const items = readdirSync(input.path);

    for (const name of items) {
      if (IGNORED_NAMES.has(name)) continue;

      const fullPath = join(input.path, name);
      try {
        const stat = statSync(fullPath);
        entries.push({
          name,
          path: fullPath,
          isDirectory: stat.isDirectory(),
          size: stat.size,
          modified: Math.floor(stat.mtimeMs / 1000),
        });
      } catch {
        // Skip entries we can't stat (permission errors, etc.)
      }
    }

    // Sort: directories first, then alphabetically
    entries.sort((a, b) => {
      if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

    return entries;
  }),
});
