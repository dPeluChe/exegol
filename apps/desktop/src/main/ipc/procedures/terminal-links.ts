import { constants, realpathSync } from "node:fs";
import { open, realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute } from "node:path";
import { linkFileKind } from "@exegol/shared";
import { TRPCError } from "@trpc/server";
import { shell } from "electron";
import { z } from "zod";
import { getAgent, getAgentCwd, getProject, listWorktrees } from "../../db/queries";
import { openInIde, resolveIde } from "../../ide/opener";
import { mapWithConcurrency } from "../../lib/concurrency";
import { resolveLinkPath } from "../../lib/link-paths";
import {
  assertSafePathIn,
  isPathInside,
  realpathSafe,
  realpathSafeSync,
} from "../../security/path-guard";
import { publicProcedure, router } from "../trpc";
import { openWithSystemApp, readForViewer } from "./files";

type Ctx = { db: import("libsql").Database };

const linkInput = z.object({
  agentId: z.string().regex(/^[a-zA-Z0-9_-]+$/),
  /** The shell's cwd from OSC 7: it can only narrow the session's own folder, never widen it */
  cwd: z.string().max(4096).optional(),
});
const linkText = z.string().min(1).max(1024);

type LinkOpen = "reveal" | "external" | "ide";

/** Only listed documents and media go to a default app; anything else (scripts, apps,
 *  .webloc/.url/.html that run or redirect) is revealed in Finder, whatever the renderer asked */
export function linkOpenAction(path: string, how: LinkOpen): LinkOpen {
  const kind = linkFileKind(path);
  if (how === "external" && kind !== "system" && kind !== "peek") return "reveal";
  return how;
}

/** Relative paths resolve against main's session folder; a renderer cwd counts only inside it */
function sessionCwd(ctx: Ctx, input: z.infer<typeof linkInput>): string | null {
  const own = getAgentCwd(ctx.db, input.agentId);
  if (!own || !input.cwd || !isAbsolute(input.cwd)) return own;
  return isPathInside(realpathSafeSync(own), realpathSafeSync(input.cwd)) ? input.cwd : own;
}

/**
 * A link reaches a file only when its realpath is inside the session's own project or one of
 * that project's worktrees and passes the path guard (sensitive names, symlinks out). Session
 * output is never trusted: an agent can print anything. Returns the canonical realpath, the only
 * path read or opened.
 */
async function linkAccess(ctx: Ctx, input: z.infer<typeof linkInput>) {
  const agent = getAgent(ctx.db, input.agentId);
  const project = agent ? getProject(ctx.db, agent.projectId) : null;
  const cwd = sessionCwd(ctx, input);
  if (!project || !cwd) return async (_text: string): Promise<string | null> => null;
  const bases = await Promise.all(
    [project.path, ...listWorktrees(ctx.db, project.id).map((w) => w.path)].map(realpathSafe),
  );
  return async (text: string): Promise<string | null> => {
    try {
      return await assertSafePathIn(resolveLinkPath(text, cwd, homedir()), bases);
    } catch {
      return null;
    }
  };
}

const forbidden = () => new TRPCError({ code: "FORBIDDEN", message: "Not a project file" });

async function requireAccess(ctx: Ctx, input: z.infer<typeof linkInput> & { text: string }) {
  const path = await (await linkAccess(ctx, input))(input.text);
  if (!path) throw forbidden();
  return path;
}

/** The checked path must still be itself when acting on it: a swap to a symlink since the check
 *  changes its realpath */
function recheck(path: string): void {
  let real: string;
  try {
    real = realpathSync.native(path);
  } catch {
    throw forbidden();
  }
  if (real !== path) throw forbidden();
}

/** Pins the checked file: no symlink at the end (O_NOFOLLOW), no FIFO to block on, and the open
 *  fd must be the same inode the realpath names now */
export async function openPinned(path: string) {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const [held, now, real] = await Promise.all([handle.stat(), stat(path), realpath(path)]);
    if (!held.isFile() || real !== path || held.dev !== now.dev || held.ino !== now.ino) {
      throw forbidden();
    }
    return handle;
  } catch (err) {
    await handle.close();
    throw err;
  }
}

export const terminalLinksRouter = router({
  /** One call per terminal viewport: which printed paths are project files. Anything outside is
   *  not a link, existing or not */
  resolve: publicProcedure
    .input(linkInput.extend({ texts: z.array(linkText).max(300) }))
    .query(async ({ ctx, input }) => {
      const access = await linkAccess(ctx, input);
      return mapWithConcurrency(input.texts, 16, async (text) => {
        try {
          const path = await access(text);
          if (!path || !(await stat(path)).isFile()) return { text, path: null };
          return { text, path };
        } catch {
          return { text, path: null };
        }
      });
    }),

  /** Read-only: a link never writes */
  read: publicProcedure
    .input(linkInput.extend({ text: linkText }))
    .query(async ({ ctx, input }) => {
      const path = await requireAccess(ctx, input);
      return { ...(await readForViewer(path, { svgAsImage: true, open: openPinned })), path };
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
        const { ide, customPath } = resolveIde(ctx.db, getAgent(ctx.db, input.agentId)?.projectId);
        recheck(path);
        const opened = await openInIde(path, ide, customPath, input.line);
        return { opened: true, revealed: false, ...opened };
      }
      if (how === "reveal") {
        recheck(path);
        shell.showItemInFolder(path);
        return { opened: false, revealed: true };
      }
      return openWithSystemApp(path, () => recheck(path));
    }),
});
