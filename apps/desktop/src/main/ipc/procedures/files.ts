import { access, mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
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
  exists: publicProcedure.input(z.object({ path: z.string() })).query(async ({ ctx, input }) => {
    assertPathInsideProject(input.path, ctx);
    try {
      await access(input.path);
      return { exists: true };
    } catch {
      return { exists: false };
    }
  }),

  readFile: publicProcedure.input(z.object({ path: z.string() })).query(async ({ ctx, input }) => {
    assertPathInsideProject(input.path, ctx);
    try {
      const content = await readFile(input.path, "utf-8");
      const ext = extname(input.path);
      const language = EXTENSION_LANGUAGES[ext] ?? "plaintext";
      return { content, language };
    } catch (err: unknown) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "EACCES" || code === "EPERM") {
        throw new TRPCError({ code: "FORBIDDEN", message: `Permission denied: ${input.path}` });
      }
      throw new TRPCError({ code: "NOT_FOUND", message: `File not found: ${input.path}` });
    }
  }),

  writeFile: publicProcedure
    .input(z.object({ path: z.string(), content: z.string() }))
    .mutation(async ({ ctx, input }) => {
      assertPathInsideProject(input.path, ctx);
      await writeFile(input.path, input.content, "utf-8");
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

  create: publicProcedure
    .input(z.object({ path: z.string(), type: z.enum(["file", "folder"]) }))
    .mutation(async ({ ctx, input }) => {
      assertPathInsideProject(input.path, ctx);
      if (input.type === "folder") {
        await mkdir(input.path, { recursive: true });
      } else {
        await writeFile(input.path, "", "utf-8");
      }
      return { success: true };
    }),

  delete: publicProcedure.input(z.object({ path: z.string() })).mutation(async ({ ctx, input }) => {
    assertPathInsideProject(input.path, ctx);
    await rm(input.path, { recursive: true });
    return { success: true };
  }),

  listDirectory: publicProcedure
    .input(z.object({ path: z.string() }))
    .query(async ({ ctx, input }) => {
      assertPathInsideProject(input.path, ctx);
      let items: string[];
      try {
        items = await readdir(input.path);
      } catch {
        throw new TRPCError({ code: "NOT_FOUND", message: `Directory not found: ${input.path}` });
      }

      const entries: DirectoryEntry[] = [];

      const statPromises = items
        .filter((name) => !IGNORED_NAMES.has(name))
        .map(async (name) => {
          const fullPath = join(input.path, name);
          try {
            const s = await stat(fullPath);
            return {
              name,
              path: fullPath,
              isDirectory: s.isDirectory(),
              size: s.size,
              modified: Math.floor(s.mtimeMs / 1000),
            } satisfies DirectoryEntry;
          } catch {
            return null; // Skip entries we can't stat
          }
        });

      const results = await Promise.all(statPromises);
      for (const entry of results) {
        if (entry) entries.push(entry);
      }

      // Sort: directories first, then alphabetically
      entries.sort((a, b) => {
        if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
        return a.name.localeCompare(b.name);
      });

      return entries;
    }),
});
