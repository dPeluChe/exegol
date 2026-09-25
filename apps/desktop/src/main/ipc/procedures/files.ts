import { access, mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, extname, join, resolve } from "node:path";
import { TRPCError } from "@trpc/server";
import { BrowserWindow, dialog, shell } from "electron";
import { z } from "zod";
import { listProjects } from "../../db/queries";
import { isPathAllowed, isProtectedRoot } from "../../security/path-guard";
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
 * Uses realpath + relative() to prevent both symlink traversal and prefix
 * confusion attacks (e.g. /repo/app matching /repo/app-evil via startsWith).
 */
function allowedBases(ctx: { db: import("libsql").Database }): string[] {
  return [...listProjects(ctx.db).map((p) => p.path), resolve(homedir(), ".exegol")];
}

async function assertPathInsideProject(
  filePath: string,
  ctx: { db: import("libsql").Database },
): Promise<void> {
  const allowed = await isPathAllowed(filePath, allowedBases(ctx));
  if (!allowed) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Access denied: path is outside any registered project directory",
    });
  }
}

/** Shown as an image or PDF instead of text */
const PREVIEW_MIME: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".bmp": "image/bmp",
  ".ico": "image/x-icon",
  ".pdf": "application/pdf",
};
const MAX_PREVIEW_BYTES = 25 * 1024 * 1024;
/** Monaco chokes well before this; the viewer offers the default app instead */
const MAX_TEXT_BYTES = 5 * 1024 * 1024;

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
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
    await assertPathInsideProject(input.path, ctx);
    return { exists: await exists(input.path) };
  }),

  /**
   * What the viewer should do with a file. Everything used to be read as UTF-8
   * text and handed to Monaco, so a PDF or a PNG showed as mojibake. `kind`
   * says how to show it; text keeps `content`/`language` (Tasks reads markdown).
   */
  readFile: publicProcedure.input(z.object({ path: z.string() })).query(async ({ ctx, input }) => {
    await assertPathInsideProject(input.path, ctx);
    try {
      const ext = extname(input.path).toLowerCase();
      const { size } = await stat(input.path);
      const mime = PREVIEW_MIME[ext];
      if (mime) {
        if (size > MAX_PREVIEW_BYTES)
          return { kind: "too-large" as const, content: "", language: "", size };
        const data = await readFile(input.path);
        return {
          kind: mime === "application/pdf" ? ("pdf" as const) : ("image" as const),
          content: "",
          language: "",
          size,
          mime,
          base64: data.toString("base64"),
        };
      }
      if (size > MAX_TEXT_BYTES)
        return { kind: "too-large" as const, content: "", language: "", size };
      const data = await readFile(input.path);
      // A NUL in the first 8KB: not text (zip, sqlite, fonts...)
      if (data.subarray(0, 8192).includes(0))
        return { kind: "binary" as const, content: "", language: "", size };
      const language = EXTENSION_LANGUAGES[ext] ?? "plaintext";
      return { kind: "text" as const, content: data.toString("utf-8"), language, size };
    } catch (err: unknown) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "EACCES" || code === "EPERM") {
        throw new TRPCError({ code: "FORBIDDEN", message: `Permission denied: ${input.path}` });
      }
      throw new TRPCError({ code: "NOT_FOUND", message: `File not found: ${input.path}` });
    }
  }),

  /** Show the file or folder selected in Finder */
  reveal: publicProcedure.input(z.object({ path: z.string() })).mutation(async ({ ctx, input }) => {
    await assertPathInsideProject(input.path, ctx);
    shell.showItemInFolder(input.path);
    return { success: true };
  }),

  /** Open with the app macOS uses for it (Preview for a PDF, etc.) */
  openExternal: publicProcedure
    .input(z.object({ path: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await assertPathInsideProject(input.path, ctx);
      const error = await shell.openPath(input.path);
      if (error) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: error });
      return { success: true };
    }),

  rename: publicProcedure
    .input(z.object({ from: z.string(), to: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await assertPathInsideProject(input.from, ctx);
      await assertPathInsideProject(dirname(input.to), ctx);
      if (isProtectedRoot(input.from, allowedBases(ctx))) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Refusing to rename a project root or .git",
        });
      }
      if (await exists(input.to)) {
        throw new TRPCError({ code: "CONFLICT", message: `Already exists: ${input.to}` });
      }
      await rename(input.from, input.to);
      return { success: true };
    }),

  writeFile: publicProcedure
    .input(z.object({ path: z.string(), content: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await assertPathInsideProject(input.path, ctx);
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
      await assertPathInsideProject(input.path, ctx);
      if (input.type === "folder") {
        await mkdir(input.path, { recursive: true });
      } else {
        // "wx": an existing file with that name used to be overwritten with an empty one
        try {
          await writeFile(input.path, "", { encoding: "utf-8", flag: "wx" });
        } catch (err) {
          if ((err as NodeJS.ErrnoException).code === "EEXIST") {
            throw new TRPCError({ code: "CONFLICT", message: `Already exists: ${input.path}` });
          }
          throw err;
        }
      }
      return { success: true };
    }),

  delete: publicProcedure.input(z.object({ path: z.string() })).mutation(async ({ ctx, input }) => {
    await assertPathInsideProject(input.path, ctx);
    if (isProtectedRoot(input.path, allowedBases(ctx))) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "Refusing to delete a project root or .git",
      });
    }
    await rm(input.path, { recursive: true });
    return { success: true };
  }),

  listDirectory: publicProcedure
    .input(z.object({ path: z.string() }))
    .query(async ({ ctx, input }) => {
      await assertPathInsideProject(input.path, ctx);
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
