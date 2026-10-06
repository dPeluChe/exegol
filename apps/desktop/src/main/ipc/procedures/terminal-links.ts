import { stat } from "node:fs/promises";
import { homedir } from "node:os";
import { extname, isAbsolute } from "node:path";
import { TRPCError } from "@trpc/server";
import { shell } from "electron";
import { z } from "zod";
import {
  getAgent,
  getAgentCwd,
  getProject,
  listAllWorktreeRows,
  listProjects,
} from "../../db/queries";
import { getAppSettings } from "../../db/queries/settings";
import { openInIde } from "../../ide/opener";
import { resolveLinkPath } from "../../lib/link-paths";
import { assertSafePath, isPathInside, realpathSafeSync } from "../../security/path-guard";
import { publicProcedure, router } from "../trpc";
import { openWithSystemApp, readForViewer } from "./files";

type Ctx = { db: import("libsql").Database };

const linkInput = z.object({
  agentId: z.string().regex(/^[a-zA-Z0-9_-]+$/),
  /** The shell's cwd from OSC 7: it can only narrow the session's own folder, never widen it */
  cwd: z.string().max(4096).optional(),
});
const linkText = z.string().min(1).max(1024);

/** A default app may open these; anything else (scripts, apps, archives, .webloc/.url/.html
 *  that run or redirect) is revealed in Finder, whatever the renderer asked */
const DEFAULT_APP_EXT = new Set(
  [
    "pdf",
    "doc",
    "docx",
    "xls",
    "xlsx",
    "ppt",
    "pptx",
    "odt",
    "ods",
    "odp",
    "rtf",
    "key",
    "numbers",
    "pages",
    "png",
    "jpg",
    "jpeg",
    "gif",
    "webp",
    "bmp",
    "tiff",
    "heic",
    "mp3",
    "wav",
    "m4a",
    "aac",
    "flac",
    "mp4",
    "mov",
    "m4v",
    "webm",
    "txt",
    "md",
    "csv",
    "log",
    "json",
  ].map((e) => `.${e}`),
);

export type LinkOpen = "reveal" | "external" | "ide";

export function linkOpenAction(path: string, how: LinkOpen): LinkOpen {
  if (how === "external" && !DEFAULT_APP_EXT.has(extname(path).toLowerCase())) return "reveal";
  return how;
}

/** Relative paths resolve against main's session folder; a renderer cwd counts only inside it */
function sessionCwd(ctx: Ctx, input: z.infer<typeof linkInput>): string | null {
  const own = getAgentCwd(ctx.db, input.agentId);
  if (!own || !input.cwd || !isAbsolute(input.cwd)) return own;
  return isPathInside(realpathSafeSync(own), realpathSafeSync(input.cwd)) ? input.cwd : own;
}

/**
 * A link reaches a file only when its realpath is inside a project or one of its worktrees and
 * passes the path guard (sensitive names, symlinks out). Session output is never trusted: an
 * agent can print anything. Returns the canonical realpath, the only path read or opened.
 */
function linkAccess(ctx: Ctx, input: z.infer<typeof linkInput>) {
  const cwd = sessionCwd(ctx, input);
  const bases = [
    ...listProjects(ctx.db).map((p) => p.path),
    ...listAllWorktreeRows(ctx.db).map((w) => w.path),
  ];
  return async (text: string): Promise<string | null> => {
    if (!cwd) return null;
    try {
      return await assertSafePath(resolveLinkPath(text, cwd, homedir()), { allowedBases: bases });
    } catch {
      return null;
    }
  };
}

async function requireAccess(ctx: Ctx, input: z.infer<typeof linkInput> & { text: string }) {
  const path = await linkAccess(ctx, input)(input.text);
  if (!path) throw new TRPCError({ code: "FORBIDDEN", message: "Not a project file" });
  return path;
}

async function openInUserIde(ctx: Ctx, agentId: string, path: string, line?: number) {
  const agent = getAgent(ctx.db, agentId);
  const project = agent ? getProject(ctx.db, agent.projectId) : null;
  const settings = getAppSettings(ctx.db);
  const ide = settings.defaultIde ?? project?.defaultIde ?? "vscode";
  await openInIde(path, ide, settings.customIdePath ?? undefined, line);
}

export const terminalLinksRouter = router({
  /** One call per terminal viewport: which printed paths are project files. Anything outside is
   *  not a link, existing or not */
  resolve: publicProcedure
    .input(linkInput.extend({ texts: z.array(linkText).max(300) }))
    .query(async ({ ctx, input }) => {
      const access = linkAccess(ctx, input);
      return Promise.all(
        input.texts.map(async (text) => {
          try {
            const path = await access(text);
            if (!path || !(await stat(path)).isFile()) return { text, path: null };
            return { text, path };
          } catch {
            return { text, path: null };
          }
        }),
      );
    }),

  /** Read-only: a link never writes */
  read: publicProcedure
    .input(linkInput.extend({ text: linkText }))
    .query(async ({ ctx, input }) => {
      const path = await requireAccess(ctx, input);
      return { ...(await readForViewer(path, { svgAsImage: true })), path };
    }),

  open: publicProcedure
    .input(
      linkInput.extend({
        text: linkText,
        how: z.enum(["reveal", "external", "ide"]),
        line: z.number().int().positive().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const path = await requireAccess(ctx, input);
      const how = linkOpenAction(path, input.how);
      if (how === "ide") {
        await openInUserIde(ctx, input.agentId, path, input.line);
        return { opened: true, revealed: false };
      }
      if (how === "reveal") {
        shell.showItemInFolder(path);
        return { opened: false, revealed: true };
      }
      return openWithSystemApp(path);
    }),
});
